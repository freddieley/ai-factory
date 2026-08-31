# Fusion setup

Autodesk Fusion currently exposes a local MCP server from the desktop application.

Enable:

`Preferences > General > API > Fusion MCP Server`

Default endpoint:

`http://127.0.0.1:27182/mcp`

Fusion must remain open while the local MCP server is used.

The AI Factory client connects through the standard MCP client SDK and discovers tools at runtime.

If the endpoint cannot be reached:

1. Make sure Fusion desktop is open.
2. Confirm the MCP checkbox is enabled.
3. Confirm the configured port.
4. Run `npm run doctor`.
