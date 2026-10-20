export function GET() {
  return Response.json(
    { version: process.env.NEXT_PUBLIC_APP_VERSION ?? "development" },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
