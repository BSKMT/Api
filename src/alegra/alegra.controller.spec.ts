import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AlegraController } from "./alegra.controller";
import type { AlegraService } from "./alegra.service";
import type { EnvironmentConfig } from "../config/config.interface";

describe("AlegraController", () => {
  let alegraService: { handleWebhook: jest.Mock };

  beforeEach(() => {
    alegraService = {
      handleWebhook: jest.fn().mockResolvedValue(undefined),
    };
  });

  function buildController(secret?: string): AlegraController {
    const configService = {
      get: jest.fn((key: string) =>
        key === "ALEGRA_WEBHOOK_SECRET" ? secret : undefined,
      ),
    } as unknown as ConfigService<EnvironmentConfig>;

    return new AlegraController(
      alegraService as unknown as AlegraService,
      configService,
    );
  }

  it("rejects with an opaque 401 message when ALEGRA_WEBHOOK_SECRET is not configured", async () => {
    const controller = buildController(undefined);

    await expect(controller.handleWebhook({})).rejects.toThrow(
      new UnauthorizedException("Invalid webhook secret token"),
    );
    expect(alegraService.handleWebhook).not.toHaveBeenCalled();
  });

  it("rejects when header token is missing or wrong", async () => {
    const controller = buildController("super-secret-token-32-chars-minimum");

    await expect(controller.handleWebhook({}, undefined)).rejects.toThrow(
      new UnauthorizedException("Invalid webhook secret token"),
    );
    await expect(controller.handleWebhook({}, "wrong-token")).rejects.toThrow(
      new UnauthorizedException("Invalid webhook secret token"),
    );
    expect(alegraService.handleWebhook).not.toHaveBeenCalled();
  });

  it("accepts connectivity check with valid X-Webhook-Token without invoking handleWebhook", async () => {
    const secret = "super-secret-token-32-chars-minimum";
    const controller = buildController(secret);

    const result = await controller.handleWebhook({}, secret);

    expect(result).toEqual({ received: true });
    expect(alegraService.handleWebhook).not.toHaveBeenCalled();
  });

  it("delegates valid webhook payload when authenticated via Authorization Bearer", async () => {
    const secret = "super-secret-token-32-chars-minimum";
    const controller = buildController(secret);
    const payload = {
      event: "invoice.updated",
      message: { invoice: { id: "29" } },
    };

    const result = await controller.handleWebhook(
      payload,
      undefined,
      `Bearer ${secret}`,
    );

    expect(result).toEqual({ received: true });
    expect(alegraService.handleWebhook).toHaveBeenCalledWith(payload);
  });
});
