import { LoginView } from "./login-view";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  return <LoginView initialMode={mode === "create" ? "create" : "signin"} />;
}
