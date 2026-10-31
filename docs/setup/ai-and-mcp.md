# AI and connected apps

Everything here is optional and starts off. Family time works the same without it. The design is in ADR 0016.

## Before you start

AI keys are sealed with the master key, `secrets/master_key`. If you set up Family time before version 0.8.0, make it now, then deploy:

```bash
./scripts/init.sh      # adds only what is missing
./scripts/update.sh
```

Without the master key, Settings says AI is not set up, and AI and MCP stay off.

## AI

1. On your phone, open Settings, then AI and connected apps. Only the owner sees this.
2. Under Providers, tap Set up next to one, and paste its key:
   - **Anthropic, OpenAI, Mistral**: an API key from the provider's console. Set a spending limit there too.
   - **Google**: a key on a paid plan only, and turn on This key is on a paid plan. On the free plan Google uses what you send to improve its products.
   - **Amazon Bedrock**: temporary session credentials as JSON, `{"accessKeyId": "...", "secretAccessKey": "...", "sessionToken": "..."}`, and the region (`eu-west-2` by default). The models are the `eu.` inference profiles. Session credentials expire, so paste fresh ones when calls start failing.
   - **Ollama**: the address of your own Ollama, for example `http://192.168.1.20:11434/v1`. No key. Nothing leaves your network.
3. Turn on Use AI, then each feature you want. Pick the provider and model, and set the monthly limit in pence.
4. Plain-English control sends what you type. Turn on Send what you type to a cloud provider for it, or use Ollama. Children's names are replaced by Child A and Child B before anything leaves.

The key is shown only as its last four characters from then on. To replace it, paste a new one; to stop using a provider, tap Change, then Remove.

### What each feature does

| Feature | Where | Sends | Without AI |
|---|---|---|---|
| Plain-English control | Control, Ask in your own words | What you type, your app and group names, the day and time | Allow, Block and Pause as usual |
| Job ideas | Jobs, Ideas for new jobs | Age bands of your jobs, your job titles, the month, the weather | A list that suits most ages |
| Weekly note | Family, For the family review | Totals only | The same totals, written out |

Every suggestion is a card on Approvals. Nothing changes until a parent approves it.

### The weather for job ideas

Add an MCP server that gives a forecast under Weather for job ideas: its https address, the tool to call, and your town. Family time calls only that tool, with only your town, and treats what comes back as data.

## Connected apps (MCP)

This lets an assistant such as Claude see each child's status and suggest changes, which arrive as cards on Approvals.

1. In Settings, AI and connected apps, turn on Let apps connect. The address to give the assistant is shown there: your Family time address followed by `/mcp`, for example `https://family.example.com/mcp`.
2. In the assistant, add a custom connector with that address.
3. The assistant opens Family time on your phone. Sign in if asked, check what it asks for, and tap Yes, connect it. As the owner, this also lets the app in for the other parents.
4. Ask it, for example, "What can Ollie use right now?" or "Suggest an hour of YouTube for Ollie". It asks you to confirm a suggestion, then the card appears on Approvals.

To stop an app at once, tap Remove next to it in Settings. Its sign-ins stop working straight away.

The address must be reachable by the assistant's company, which means through Caddy from the internet. Only `/mcp`, `/oauth/token` and the two `/.well-known/` addresses are used, and every one of them says "off" until you switch MCP on.

## What to check on your phone

1. With AI off, Control, Jobs and Family look as before.
2. Switch on plain-English control, type "YouTube for an hour", and see a card on Approvals. Approve it and see YouTube allowed on Control.
3. Connect Claude, ask for status, ask it to suggest an Allow, and approve the card.

Paste anything odd, and the output of `./scripts/update.sh`, back into the build chat.
