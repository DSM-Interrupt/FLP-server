import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import {
  ForbiddenException,
  forwardRef,
  Inject,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtPayload, Role } from '../auth/jwt/jwt.config';
import { HostService } from './host.service';
import { HostEntity } from './entities/host.entity';
import { HostInfoDto } from './dto/host.info.dto';

@WebSocketGateway({
  namespace: '/host/location', // 필요시 네임스페이스 지정
  pingInterval: 3000,
  pingTimeout: 30000, // 30초 안에 pong 응답 없으면 연결 끊음
})
export class HostGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => HostService))
    private readonly hostService: HostService,
  ) {}
  private clients: Map<HostEntity, CustomSocket> = new Map();
  private readonly logger = new Logger('HostGateway');

  handleDisconnect() {
    this.logger.log('handleDisconnect');
  }
  async handleConnection(client: CustomSocket) {
    this.logger.log('handleConnection');
    const authorization = client.handshake.query.Authorization as string;
    if (!authorization || !authorization.startsWith('Bearer '))
      throw new UnauthorizedException();
    const token = authorization.replace('Bearer ', '');
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
    } catch (err) {
      client.emit('error', err);
      client.disconnect();
      this.logger.log('handleConnection', 'err', err);
      throw new UnauthorizedException('잘못된 토큰입니다');
    }
    this.logger.log('handleConnection', payload);
    if (payload.role !== Role.host)
      throw new ForbiddenException('권한이 없습니다');
    const user = await this.hostService.findOneName(payload.name);
    if (!user) throw new UnauthorizedException('잘못된 유저');
    else {
      client.data.user = user;
      this.clients.set(user, client);
      await this.hostService.location(user);
    }
  }
  info(user: HostEntity, dto: HostInfoDto) {
    this.logger.log('info', user, dto);
    this.clients.get(user)?.emit('info', dto);
  }
}

interface CustomSocket extends Socket {
  data: {
    user: HostEntity; // 혹은 더 구체적인 User 타입
  };
}
