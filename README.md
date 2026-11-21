# Doc Intel Chat

Upload documents, extract their content with **Azure AI Document Intelligence**, store the results in **PostgreSQL**, and **chat** with them using the LLM provider of your choice.

| Layer | Tech |
|---|---|
| App | Next.js 16 (App Router, Route Handlers), React 19, TypeScript, Tailwind CSS 4 |
| Extraction | Azure AI Document Intelligence (`@azure-rest/ai-document-intelligence`), `prebuilt-layout` model by default |
| Database | PostgreSQL 17 + Drizzle ORM, full-text search (`tsvector` + GIN index) for retrieval |
| Chat | Vercel AI SDK: OpenRouter, Azure OpenAI, Ollama, Groq, Google Gemini, Anthropic Claude, OpenAI |

## How it works

1. **Upload**: files are saved to `uploads/` and a `documents` row is created with status `uploaded`.
2. **Analyze**: after the response is sent (`after()` in Next.js), the file is sent to Document Intelligence. The status changes to `processing`.
3. **Store**: the result is written to Postgres:
   - `documents.content`: the full document as Markdown (headings and tables are preserved), plus the raw `analyzeResult` JSON
   - `document_chunks`: ~1,500-character chunks with page numbers and a generated `tsvector` column for search
   - `document_tables`: every table as a 2D array of cell text
   - `document_fields`: key-value pairs (layout model) or typed fields (invoice, receipt, ID and other prebuilt models)
4. **Chat**: your question is matched against the chunks with Postgres full-text search. The top passages are sent to the chosen LLM with instructions to cite sources (`[1]`, `[2]` …). The answer streams back with source links. You can chat across **all documents** (`/chat`) or **one document** (its *Chat* tab).

---

## 1. Prerequisites

- Node.js 20+
- Docker Desktop (for the local Postgres), or any PostgreSQL 14+ database
- An Azure subscription ([free account](https://azure.microsoft.com/free/))
- At least one chat provider. Free options: OpenRouter `:free` models, Groq, Google Gemini, or a local Ollama

## 2. Set up Azure AI Document Intelligence

### Option A: Azure portal

1. Sign in to the [Azure portal](https://portal.azure.com).
2. Select **Create a resource**, search for **Document Intelligence** (formerly *Form Recognizer*) and choose **Create**.
3. Fill in the form:
   - **Subscription / Resource group**: choose or create one (for example `rg-doc-intel`)
   - **Region**: pick one close to you (for example *East US*, *West Europe* or *Central India*)
   - **Name**: a globally unique name (for example `docintel-yourname`). This becomes part of the endpoint URL.
   - **Pricing tier**: **Free F0** for trying it out (500 pages/month, files up to 4 MB, only the first 2 pages of each document are analyzed) or **Standard S0** for real use (up to 500 MB per file and 2,000 pages).
4. Select **Review + create**, then **Create**. Wait for the deployment to finish and choose **Go to resource**.
5. Open **Resource Management → Keys and Endpoint** and copy:
   - **Endpoint**, for example `https://docintel-yourname.cognitiveservices.azure.com/`
   - **KEY 1**
6. Put them in `.env.local` (see step 3):
   ```env
   AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://docintel-yourname.cognitiveservices.azure.com/
   AZURE_DOCUMENT_INTELLIGENCE_KEY=<KEY 1>
   ```

### Option B: Azure CLI

```bash
az login
az group create --name rg-doc-intel --location eastus
az cognitiveservices account create \
  --name docintel-yourname --resource-group rg-doc-intel \
  --kind FormRecognizer --sku F0 --location eastus --yes
# Endpoint
az cognitiveservices account show --name docintel-yourname --resource-group rg-doc-intel --query properties.endpoint -o tsv
# Key
az cognitiveservices account keys list --name docintel-yourname --resource-group rg-doc-intel --query key1 -o tsv
```

> Only one free (F0) Document Intelligence resource is allowed per subscription. Use `--sku S0` if you already have one.

### Choose a model (optional)

Set `AZURE_DOCUMENT_INTELLIGENCE_MODEL` in `.env.local`:

| Model | Use it for |
|---|---|
| `prebuilt-layout` *(default)* | General documents: text, headings, tables, selection marks, key-value pairs |
| `prebuilt-read` | Plain OCR, cheapest option |
| `prebuilt-invoice`, `prebuilt-receipt`, `prebuilt-idDocument`, `prebuilt-tax.us.w2` … | Typed fields for known document types (shown on the *Key-value pairs* tab) |
| Your custom model id | Models you trained in [Document Intelligence Studio](https://documentintelligence.ai.azure.com/studio) |

You can try any model on your own files in **Document Intelligence Studio** before switching.

### Production notes

- Instead of keys, you can use Microsoft Entra ID (managed identity). Swap `AzureKeyCredential` in `src/lib/document-intelligence.ts` for `DefaultAzureCredential` from `@azure/identity`, and grant the app the **Cognitive Services User** role.
- Keep keys in Azure Key Vault or your host's secret store, not in source control. `.env.local` is already ignored by git.

## 3. Configure the app

```bash
cd doc-intel-chat
npm install
cp .env.example .env.local     # on Windows PowerShell: Copy-Item .env.example .env.local
```

Edit `.env.local`: add the Document Intelligence endpoint and key, plus at least one chat provider.

### Chat providers

Configure any number of providers. The chat screen has a dropdown listing every configured provider and a model field (type any model id the provider supports). `DEFAULT_CHAT_PROVIDER` chooses the preselected provider.

| Provider | Cost | Setup |
|---|---|---|
| **OpenRouter** | Free models available (ids ending in `:free`) | Create a key at [openrouter.ai/keys](https://openrouter.ai/keys) and set `OPENROUTER_API_KEY`. One key gives you Llama, DeepSeek, Gemini, Claude, GPT and others. |
| **Azure OpenAI** | Paid (your Azure subscription) | In [Azure AI Foundry](https://ai.azure.com), create an Azure OpenAI resource and deploy a model (for example `gpt-4o-mini`). Set `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_RESOURCE_NAME` (the `<name>` in `https://<name>.openai.azure.com`) and `AZURE_OPENAI_DEPLOYMENT` (your **deployment name**). |
| **Ollama** | Free, runs locally | Install from [ollama.com](https://ollama.com), run `ollama pull llama3.2`, then set `OLLAMA_BASE_URL=http://localhost:11434`. |
| **Groq** | Free tier | Create a key at [console.groq.com/keys](https://console.groq.com/keys) and set `GROQ_API_KEY`. |
| **Google Gemini** | Free tier | Create a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and set `GOOGLE_GENERATIVE_AI_API_KEY`. |
| **Anthropic Claude** | Paid | Create a key at [console.anthropic.com](https://console.anthropic.com) and set `ANTHROPIC_API_KEY`. |
| **OpenAI** | Paid | Create a key at [platform.openai.com](https://platform.openai.com/api-keys) and set `OPENAI_API_KEY`. |

Free tiers and model names change often. If a default model id stops working, choose another one from the provider's model list and set it in `.env.local` or type it in the chat UI.

To add another OpenAI-compatible provider (Together, Mistral, LM Studio, vLLM …), add an entry to `src/lib/ai/providers.ts` that uses `createOpenAICompatible` with its base URL.

## 4. Start the database

```bash
npm run db:up        # starts PostgreSQL 17 in Docker (docker-compose.yml)
npm run db:migrate   # creates the tables from drizzle/
```

To use a hosted Postgres (Azure Database for PostgreSQL, Neon, Supabase …), set `DATABASE_URL` and run `npm run db:migrate`. `npm run db:studio` opens Drizzle Studio so you can browse the stored data.

## 5. Run

```bash
npm run dev
```

Open http://localhost:3000, upload a PDF or image, and wait for the status to change to **ready**. Then open the document to see the extracted content, tables and key-value pairs, or go to **Chat**.

For production, run `npm run build` and then `npm start`.

---

## Project structure

```
src/
  app/
    page.tsx                         Upload + document list
    documents/[id]/page.tsx          Extracted content, tables, fields, per-document chat
    chat/page.tsx                    Chat across all documents
    api/
      documents/route.ts             GET list, POST upload (starts analysis with after())
      documents/[id]/route.ts        GET detail, DELETE
      documents/[id]/reprocess/      POST re-run analysis
      chat/route.ts                  Retrieval + streaming answer
      providers/route.ts             Configured chat providers for the UI
  components/                        Chat panel, Markdown renderer, status badge
  db/schema.ts                       Drizzle schema (documents, chunks, tables, fields)
  lib/
    document-intelligence.ts         Azure client + analyze call
    process-document.ts              Chunking and persistence of the analysis result
    retrieval.ts                     Postgres full-text search over chunks
    ai/providers.ts                  Multi-provider LLM registry
drizzle/                             SQL migrations
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Status is `failed` with *401 / Access denied* | Check the endpoint and key; the key must belong to that endpoint. |
| *InvalidContent* or the file is too large | The F0 tier accepts files up to 4 MB. Use S0 or a smaller file. |
| Only the first 2 pages were extracted | This is an F0 tier limit. Upgrade to S0. |
| *No chat provider is configured* | Set at least one provider key in `.env.local` and restart `npm run dev`. |
| Chat says the model is not found | The model id is wrong for that provider, or (Azure) you entered the model name instead of the **deployment name**. |
| `ECONNREFUSED 5432` | Postgres isn't running. Start Docker Desktop, then run `npm run db:up`. |

## Ideas for next steps

- Vector search (pgvector + an embeddings model) alongside full-text search for better semantic matching
- Store files in Azure Blob Storage instead of local disk
- Authentication (Auth.js or Microsoft Entra ID) and per-user documents
- Save chat history to the database
