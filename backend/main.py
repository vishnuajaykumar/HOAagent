from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import init_db
from routers import auth, super_admin, client_admin, chat
from routers.chat import close_clients


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    await close_clients()  # graceful shutdown: close Anthropic + Redis pool


app = FastAPI(
    title="HOAbot API",
    description="AI chatbot SaaS for HOA communities",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(super_admin.router)
app.include_router(client_admin.router)
app.include_router(chat.router)


from fastapi.responses import FileResponse
import os

@app.get("/widget.js")
async def get_widget():
    return FileResponse("static/widget.js", media_type="application/javascript")

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "HOAbot API"}
