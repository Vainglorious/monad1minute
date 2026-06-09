import { describe, it, expect } from "vitest";
import { scrubError, FundingError, signupFundingAmount } from "./funding";

describe("scrubError", () => {
  it("redacts the RPC url/host so embedded credentials can't leak", () => {
    const s = scrubError(new Error("HTTP request failed: POST https://rpc.monad.xyz/v1"));
    expect(s).not.toContain("rpc.monad.xyz");
    expect(s).toContain("<rpc");
  });

  it("handles non-Error inputs", () => {
    expect(typeof scrubError("boom")).toBe("string");
    expect(typeof scrubError(undefined)).toBe("string");
  });

  it("caps length", () => {
    expect(scrubError(new Error("x".repeat(1000))).length).toBeLessThanOrEqual(300);
  });
});

describe("FundingError", () => {
  it("carries the broadcast flag and tx hash", () => {
    const e = new FundingError("nope", { broadcast: true, hash: "0xabc" });
    expect(e.name).toBe("FundingError");
    expect(e.broadcast).toBe(true);
    expect(e.hash).toBe("0xabc");
  });
});

describe("signupFundingAmount", () => {
  it("defaults to 0.1 when unset", () => {
    delete process.env.SIGNUP_FUNDING_MON;
    expect(signupFundingAmount()).toBe("0.1");
  });
});
