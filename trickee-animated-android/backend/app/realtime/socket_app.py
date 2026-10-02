"""Narrow Cloud Run application for long-lived realtime connections."""
from fastapi import FastAPI, Response

from app.observability.metrics import render_metrics
from app.realtime.websocket_gateway import router

app = FastAPI(title="Trickee realtime gateway", docs_url=None, redoc_url=None)
app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok", "role": "websocket"}


@app.get("/metrics", include_in_schema=False)
def metrics():
    payload, media_type = render_metrics()
    return Response(content=payload, media_type=media_type)
