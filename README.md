# HOAbot — AI Chat Widget for HOA Communities

A SaaS chatbot widget that HOA management companies embed into their resident portals. The chatbot answers resident questions based on uploaded HOA documents (bylaws, rules & regulations) using RAG (Retrieval Augmented Generation).

## Architecture

- **Chat Widget**: React + Vite (embeddable JS snippet)
- **Backend**: Python FastAPI + RAG pipeline
- **Vector DB**: ChromaDB (document storage)
- **Cache**: Redis (rate limiting + query cache)
- **Database**: PostgreSQL (analytics, clients, usage)
- **Proxy**: Nginx
- **LLM**: Claude API (Anthropic)

## Quick Start

1. Copy environment file and fill in values:
   ```bash
   cp .env.example .env
   ```

2. Start everything:
   ```bash
   docker-compose up --build
   ```

3. Access:
   - Chat widget demo: http://localhost
   - Client admin panel: http://localhost/admin
   - Super admin panel: http://localhost/super
   - API docs: http://localhost/api/docs

## How It Works

1. HOA management company signs up at `/admin/signup`
2. Vishnu approves the account in the super admin panel
3. Client logs in, uploads HOA bylaws/rules PDFs
4. PDFs are chunked and stored in ChromaDB as vectors
5. Client gets embed code: `<script src="http://localhost/widget.js" data-key="their_key"></script>`
6. Residents chat → questions matched to relevant doc chunks → Claude answers ONLY from those chunks

## Project Structure

```
├── frontend/     # Embeddable chat widget (React + Vite)
├── backend/      # FastAPI + RAG pipeline
├── admin/        # Admin dashboard (React)
├── nginx/        # Reverse proxy config
├── documents/    # Drop HOA PDF files here
└── docker-compose.yml
```

## Adding API Key

Add your Anthropic API key to `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```
