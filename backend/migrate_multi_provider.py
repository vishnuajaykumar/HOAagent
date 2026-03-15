import asyncio
from sqlalchemy import text
from database import engine

async def migrate():
    print("Starting migration...")
    async with engine.begin() as conn:
        try:
            await conn.execute(text("ALTER TABLE communities ADD COLUMN IF NOT EXISTS ai_provider VARCHAR DEFAULT 'anthropic'"))
            await conn.execute(text("ALTER TABLE communities ADD COLUMN IF NOT EXISTS ai_model VARCHAR DEFAULT 'haiku'"))
            print("Successfully added columns to communities table.")
        except Exception as e:
            print(f"Migration error: {e}")

if __name__ == "__main__":
    asyncio.run(migrate())
