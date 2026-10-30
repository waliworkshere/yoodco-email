import { handleOAuthCallback } from "@/lib/oauth-callback";
export const GET = (req: Request) => handleOAuthCallback(req, "microsoft");
