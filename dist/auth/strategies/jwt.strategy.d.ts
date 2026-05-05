import { ConfigService } from '@nestjs/config';
import { Strategy } from 'passport-jwt';
import type { EnvironmentConfig } from '../../config/config.interface';
interface JwtPayload {
    sub: string;
    email: string;
    iat: number;
    exp: number;
}
declare const JwtStrategy_base: new (...args: [opt: import("passport-jwt").StrategyOptionsWithRequest] | [opt: import("passport-jwt").StrategyOptionsWithoutRequest]) => Strategy & {
    validate(...args: any[]): unknown;
};
export declare class JwtStrategy extends JwtStrategy_base {
    private configService;
    constructor(configService: ConfigService<EnvironmentConfig>);
    validate(payload: JwtPayload): {
        userId: string;
        email: string;
    };
}
export {};
