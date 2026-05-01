# Words Explore

Mobile-first vocabulary learning MVP built with Next.js, SQLite/libSQL, and an OpenAI-compatible LLM provider.

## DeepSeek Setup

Create `.env.local` with the API key and optional runtime overrides:

```bash
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_TEMPERATURE=0.6
```

The app calls `POST /chat/completions` through the OpenAI SDK and streams each word with an app-level delimiter.
If the key is missing or the API call fails, recommendations fall back to local mock words so the learning flow still works.
The server logs provider, model, timeout, token limit, temperature, and request duration without printing the API key.
DeepSeek model, base URL, timeout, default temperature, thinking mode, batch size, countdown, and storage mode live in TypeScript config.
`DEEPSEEK_TEMPERATURE` overrides the DeepSeek default. If it is unset, `LLM_TEMPERATURE` is used as a fallback. Valid temperature values are `0` to `2`.

You can also use any OpenAI-compatible provider with:

```bash
LLM_API_KEY=your_key
```

Then edit `src/lib/serverConfig.ts` and set `serverConfig.llm.provider` to `"openai-compatible"`.
Use `LLM_TEMPERATURE` to override the generic provider temperature.

## TypeScript Config

Non-secret runtime settings live in:

- `src/lib/appConfig.ts`: word batch size and auto-next countdown.
- `src/lib/serverConfig.ts`: LLM provider/model/base URL/default temperature/thinking mode and storage driver/path.

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
