"""
Tutor-GPT OpenWebUI Pipe

This pipe integrates OpenWebUI with the Tutor-GPT memory proxy, enabling
Honcho-backed personalized learning experiences through OpenWebUI's interface.

Architecture:
    OpenWebUI → Python Pipe → Memory Proxy (Node.js) → Honcho + OpenRouter

The pipe acts as a thin adapter that:
- Extracts user identity from OpenWebUI
- Forwards requests to the memory-proxy server
- Streams responses back to OpenWebUI
- Maintains conversation sessions via Honcho
"""

import asyncio
import json
import logging
import os
from typing import AsyncIterator, Optional
from pydantic import BaseModel, Field
import httpx


class Pipe:
    """
    OpenWebUI Pipe for Tutor-GPT integration.

    This pipe forwards chat requests to the Tutor-GPT memory proxy service,
    which handles the thought generation pipeline, memory retrieval from Honcho,
    and LLM completions via OpenRouter.
    """

    class Valves(BaseModel):
        """
        Configuration parameters for the Tutor-GPT pipe.

        These can be configured through OpenWebUI's admin panel without
        modifying the code.
        """
        PROXY_URL: str = Field(
            default=os.getenv("TUTOR_GPT_PROXY_URL", "http://localhost:8081"),
            description="Base URL of the Tutor-GPT memory proxy server"
        )
        PROXY_API_KEY: str = Field(
            default=os.getenv("TUTOR_GPT_PROXY_API_KEY", ""),
            description="API key for authenticating with the memory proxy"
        )
        TIMEOUT_SECONDS: int = Field(
            default=300,
            description="Request timeout in seconds (default: 5 minutes for long responses)"
        )
        DEBUG_MODE: bool = Field(
            default=False,
            description="Enable detailed logging for troubleshooting"
        )

    def __init__(self):
        """Initialize the pipe with default configuration."""
        self.valves = self.Valves()
        self.logger = logging.getLogger(__name__)

        # Set logging level based on debug mode
        if self.valves.DEBUG_MODE:
            self.logger.setLevel(logging.DEBUG)
        else:
            self.logger.setLevel(logging.INFO)

    def pipes(self):
        """
        Return list of available models/pipes.

        This appears as a selectable model in OpenWebUI's interface.
        """
        return [
            {
                "id": "tutor-gpt",
                "name": "Bloom Tutor (Tutor-GPT)"
            }
        ]

    async def pipe(
        self,
        body: dict,
        __user__: Optional[dict] = None,
    ) -> AsyncIterator[str]:
        """
        Main pipe processing method.

        This method is called by OpenWebUI for each chat request.
        It forwards the request to the memory proxy and streams back the response.

        Args:
            body: The request body from OpenWebUI containing messages, model, etc.
            __user__: User context from OpenWebUI containing user ID and metadata

        Yields:
            str: Server-sent event formatted response chunks
        """
        # Extract user identity
        user_id = "openwebui-user"
        if __user__ and "id" in __user__:
            user_id = f"openwebui_{__user__['id']}"

        if self.valves.DEBUG_MODE:
            self.logger.debug(f"Processing request for user: {user_id}")
            self.logger.debug(f"Request body: {json.dumps(body, indent=2)}")

        # Validate proxy configuration
        if not self.valves.PROXY_API_KEY:
            error_msg = "PROXY_API_KEY is not configured. Please set it in the Valves configuration."
            self.logger.error(error_msg)
            yield f"data: {json.dumps({'error': error_msg})}\n\n"
            return

        # Prepare headers for memory proxy authentication
        headers = {
            "Authorization": f"Bearer {self.valves.PROXY_API_KEY}",
            "Content-Type": "application/json",
            "X-User-Id": user_id,
        }

        # Ensure streaming is enabled
        body["stream"] = True

        # Build the full URL for the chat completions endpoint
        url = f"{self.valves.PROXY_URL.rstrip('/')}/v1/chat/completions"

        try:
            async with httpx.AsyncClient(timeout=self.valves.TIMEOUT_SECONDS) as client:
                if self.valves.DEBUG_MODE:
                    self.logger.debug(f"Sending request to: {url}")

                async with client.stream(
                    "POST",
                    url,
                    headers=headers,
                    json=body,
                ) as response:
                    # Check for HTTP errors
                    if response.status_code == 401:
                        error_msg = "Authentication failed. Please check your PROXY_API_KEY."
                        self.logger.error(error_msg)
                        yield f"data: {json.dumps({'error': error_msg})}\n\n"
                        return
                    elif response.status_code == 404:
                        error_msg = f"Memory proxy not found at {url}. Is the server running?"
                        self.logger.error(error_msg)
                        yield f"data: {json.dumps({'error': error_msg})}\n\n"
                        return
                    elif response.status_code >= 400:
                        error_msg = f"Memory proxy error: HTTP {response.status_code}"
                        self.logger.error(error_msg)
                        # Try to get error details from response
                        try:
                            error_body = await response.aread()
                            error_details = json.loads(error_body)
                            yield f"data: {json.dumps({'error': f'{error_msg}: {error_details}'})}\n\n"
                        except:
                            yield f"data: {json.dumps({'error': error_msg})}\n\n"
                        return

                    # Stream the response back to OpenWebUI
                    async for line in response.aiter_lines():
                        if not line:
                            continue

                        # Forward SSE data lines directly
                        if line.startswith("data: "):
                            if self.valves.DEBUG_MODE:
                                self.logger.debug(f"Streaming chunk: {line[:100]}...")
                            yield f"{line}\n\n"

        except httpx.ConnectError as e:
            error_msg = f"Cannot connect to memory proxy at {url}. Is the server running?"
            self.logger.error(f"{error_msg} Error: {str(e)}")
            yield f"data: {json.dumps({'error': error_msg})}\n\n"
        except httpx.TimeoutException as e:
            error_msg = f"Request timed out after {self.valves.TIMEOUT_SECONDS}s"
            self.logger.error(f"{error_msg} Error: {str(e)}")
            yield f"data: {json.dumps({'error': error_msg})}\n\n"
        except Exception as e:
            error_msg = f"Unexpected error: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            yield f"data: {json.dumps({'error': error_msg})}\n\n"


# For testing purposes
if __name__ == "__main__":
    import asyncio

    # Simple test to verify the pipe structure
    pipe = Pipe()
    print("Tutor-GPT Pipe initialized successfully!")
    print(f"Available models: {pipe.pipes()}")
    print(f"Proxy URL: {pipe.valves.PROXY_URL}")
    print(f"API Key configured: {'Yes' if pipe.valves.PROXY_API_KEY else 'No'}")
