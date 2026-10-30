import "server-only";
import { getSession } from "./auth";
import { encrypt } from "./crypto";
import { env } from "./env";
import { googleExchange, microsoftExchange } from "./mail/oauth";
import { upsertMailbox } from "./mailboxes";
import { verifyState } from "./oauth-state";

export async function handleOAuthCallback(req: Request, provider: "google" | "microsoft") {
  const back = (params: Record<string, string>) => Response.redirect(`${env.appUrl}/mailboxes?${new URLSearchParams(params)}`, 302);
  if (!(await getSession())) return Response.redirect(`${env.appUrl}/login`, 302);
  const url = new URL(req.url);
  const err = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (err) return back({ error: `Sign-in was cancelled or refused: ${err}` });
  try {
    const state = await verifyState(url.searchParams.get("state") ?? "");
    if (state.p !== provider) throw new Error("State mismatch");
  } catch {
    return back({ error: "The sign-in link expired. Please try connecting again." });
  }
  try {
    const code = url.searchParams.get("code") ?? "";
    const tokens = provider === "google" ? await googleExchange(code) : await microsoftExchange(code);
    if (!tokens.email) throw new Error("The provider did not return the account's email address.");
    if (!tokens.refreshToken) throw new Error("No refresh token was returned. Remove the app's access from the account's security settings and connect again.");
    const { mailbox, attached } = await upsertMailbox(tokens.email, {
      displayName: tokens.name || tokens.email.split("@")[0],
      provider: provider === "google" ? "GOOGLE" : "MICROSOFT",
      secretEnc: encrypt(tokens.refreshToken),
      accessTokenEnc: encrypt(tokens.accessToken),
      accessTokenExpiresAt: tokens.expiresAt,
      username: tokens.email,
    });
    return Response.redirect(
      `${env.appUrl}/mailboxes/${mailbox.id}?${new URLSearchParams({ notice: `Connected ${mailbox.email}.${attached ? ` ${attached} imported contacts were waiting for this sender and are now assigned.` : ""}` })}`,
      302,
    );
  } catch (e) {
    return back({ error: (e as Error).message });
  }
}
