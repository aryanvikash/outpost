# Minimal runtime image for the Outpost agent. GoReleaser injects the prebuilt
# binary into the build context, so this is a thin wrapper over a static binary.
FROM gcr.io/distroless/static:nonroot
COPY outpost-agent /usr/local/bin/outpost-agent
USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/outpost-agent"]
CMD ["--config", "/etc/outpost/agent.conf"]
