export interface EnvironmentConfig {
    mongodbUri: string;
    jwtSecret: string;
    jwtExpiration: string;
    jwtRefreshSecret: string;
    jwtRefreshExpiration: string;
    cookieDomain: string;
    cookieSecure: boolean;
    corsOrigin: string;
    port: number;
    csrfSecret: string;
    bcryptSaltRounds: number;
}
