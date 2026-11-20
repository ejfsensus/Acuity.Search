# Private SearXNG for Acuity.Search (separate Railway service, no public domain).
# Build context: repository root, e.g. dockerfilePath deploy/searxng/Dockerfile
FROM searxng/searxng:latest
COPY deploy/searxng/settings.yml /etc/searxng/settings.yml
COPY deploy/searxng/limiter.toml /etc/searxng/limiter.toml
COPY --chmod=755 deploy/searxng/entrypoint.sh /usr/local/bin/acuity-searxng-entrypoint.sh
ENV SEARXNG_PORT=8080 \
    SEARXNG_LIMITER=false \
    SEARXNG_PUBLIC_INSTANCE=false
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/acuity-searxng-entrypoint.sh"]
