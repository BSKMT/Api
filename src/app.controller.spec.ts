import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { Test, TestingModule } from "@nestjs/testing";
import { getConnectionToken } from "@nestjs/mongoose";
import { ConfigService } from "@nestjs/config";
import { AppController } from "./app.controller";
import type { Response } from "express";

describe("AppController (NIST CSF 2.0 PR.PS-06, RC.RP-05)", () => {
  let controller: AppController;
  let mockConnection: { readyState: number };
  let mockConfigService: { get: jest.Mock<(key: string) => unknown> };

  beforeEach(async () => {
    mockConnection = { readyState: 1 };
    mockConfigService = {
      get: jest.fn<(key: string) => unknown>((key: string) => {
        if (key === "BETTER_AUTH_SECRET")
          return "app-controller-secret-minimum-32chars!";
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    controller = module.get<AppController>(AppController);
  });

  it("retorna estado de salud ok cuando la base de datos está conectada (RC.RP-05)", () => {
    const health = controller.getHealth();
    expect(health.status).toBe("ok");
    expect(health.database).toBe("connected");
  });

  it("retorna estado degradado si la base de datos está desconectada", () => {
    mockConnection.readyState = 0;
    const health = controller.getHealth();
    expect(health.status).toBe("degraded");
    expect(health.database).toBe("disconnected");
  });

  it("emite un token CSRF y fija la cookie bskmt.csrf (PR.PS-06)", () => {
    const cookieMock = jest.fn();
    const mockResponse = {
      cookie: cookieMock,
    } as unknown as Response;

    const result = controller.getCsrfToken(mockResponse);
    expect(result.csrfToken).toBeDefined();
    expect(typeof result.csrfToken).toBe("string");
    expect(result.csrfToken.includes(".")).toBe(true);

    expect(cookieMock).toHaveBeenCalledWith(
      "bskmt.csrf",
      result.csrfToken,
      expect.objectContaining({
        httpOnly: false,
        sameSite: "lax",
        path: "/",
      }),
    );
  });

  it("configura domain .bskmt.com en la cookie CSRF cuando NODE_ENV es production (PR-03)", () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const cookieMock = jest.fn();
      const mockResponse = { cookie: cookieMock } as unknown as Response;
      controller.getCsrfToken(mockResponse);
      expect(cookieMock).toHaveBeenCalledWith(
        "bskmt.csrf",
        expect.any(String),
        expect.objectContaining({
          domain: ".bskmt.com",
          secure: true,
        }),
      );
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});
