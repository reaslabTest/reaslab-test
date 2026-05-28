import type { Page, Response } from "@playwright/test";

/** WSL / Cloudflare 等场景下常见的瞬时导航失败（可重试）。 */
const TRANSIENT_NAV_PATTERN =
  /ERR_(CONNECTION_CLOSED|CONNECTION_RESET|TIMED_OUT|NETWORK_CHANGED|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED)|NS_ERROR_/i;

export function isTransientNavigationError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return TRANSIENT_NAV_PATTERN.test(msg);
}

type GotoOptions = NonNullable<Parameters<Page["goto"]>[1]>;
type GotoWithRetryOptions = GotoOptions & {
  /** 默认 4（含首次）。 */
  attempts?: number;
  /** 首次重试前等待基数（ms），逐次递增。 */
  backoffMs?: number;
};

/**
 * 对 `page.goto` 做有限次重试，缓解 `net::ERR_CONNECTION_CLOSED` / `ERR_TIMED_OUT` 等间歇性失败。
 */
export async function gotoWithRetry(
  page: Page,
  url: string,
  options?: GotoWithRetryOptions,
): Promise<Response | null> {
  const { attempts = 4, backoffMs = 1500, ...gotoOptions } = options ?? {};
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await page.goto(url, gotoOptions);
      if (res && res.status() >= 500 && attempt < attempts - 1) {
        await page.waitForTimeout(backoffMs * (attempt + 1));
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
      if (!isTransientNavigationError(error) || attempt === attempts - 1) {
        throw error;
      }
      await page.waitForTimeout(backoffMs * (attempt + 1));
    }
  }

  throw lastError;
}

type WaitForURLOptions = NonNullable<Parameters<Page["waitForURL"]>[1]>;
type WaitForURLWithRetryOptions = WaitForURLOptions & {
  attempts?: number;
  backoffMs?: number;
};

export async function waitForURLWithRetry(
  page: Page,
  url: Parameters<Page["waitForURL"]>[0],
  options?: WaitForURLWithRetryOptions,
): Promise<void> {
  const { attempts = 4, backoffMs = 1500, ...waitOptions } = options ?? {};
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await page.waitForURL(url, waitOptions);
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientNavigationError(error) || attempt === attempts - 1) {
        throw error;
      }
      await page.waitForTimeout(backoffMs * (attempt + 1));
    }
  }

  throw lastError;
}
