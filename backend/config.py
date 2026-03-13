from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://postgres:password@postgres:5432/hoabot"
    redis_url: str = "redis://redis:6379"
    chroma_url: str = "http://chromadb:8001"
    anthropic_api_key: str = ""
    jwt_secret: str = "changeme"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440  # 24 hours
    super_admin_email: str = "admin@example.com"
    super_admin_password: str = "changeme"
    app_url: str = "http://localhost"

    class Config:
        env_file = ".env"


settings = Settings()
