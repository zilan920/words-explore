# Words Explore

Mobile-first vocabulary learning MVP built with Next.js, SQLite/libSQL, and an OpenAI-compatible LLM provider.

## DeepSeek Setup

Create `.env.local` with secrets only:

```bash
DEEPSEEK_API_KEY=your_deepseek_api_key
```

The app calls `POST /chat/completions` through the OpenAI SDK and streams each word with an app-level delimiter.
If the key is missing or the API call fails, recommendations fall back to local mock words so the learning flow still works.
The server logs provider, model, timeout, token limit, and request duration without printing the API key.
DeepSeek model, base URL, timeout, temperature, thinking mode, batch size, countdown, and storage mode live in TypeScript config.

You can also use any OpenAI-compatible provider with:

```bash
LLM_API_KEY=your_key
```

Then edit `src/lib/serverConfig.ts` and set `serverConfig.llm.provider` to `"openai-compatible"`.

## TypeScript Config

Non-secret runtime settings live in:

- `src/lib/appConfig.ts`: word batch size and auto-next countdown.
- `src/lib/serverConfig.ts`: LLM provider/model/base URL/temperature/thinking mode and storage driver/path.

## Development

```bash
pnpm install
pnpm dev
```

## Data Storage

By default, data is stored as a local SQLite file at `data/words-explore.sqlite`.

Configure storage in `src/lib/serverConfig.ts`:

```ts
storage: {
  driver: "file",
  sqlitePath: "data/words-explore.sqlite",
  libsqlUrl: ""
}
```

For remote libSQL/Turso storage, set `driver: "libsql"` and `libsqlUrl` in `src/lib/serverConfig.ts`, then put only the secret token in `.env.local`:

```bash
LIBSQL_AUTH_TOKEN=your_token
```

On Vercel, local files are not durable across deployments or cold starts, so use file storage for local/dev or self-hosted persistent disks.
