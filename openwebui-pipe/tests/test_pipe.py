"""
Basic tests for the Tutor-GPT OpenWebUI Pipe

Run with: python -m pytest tests/test_pipe.py
"""

import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from tutor_gpt_pipe import Pipe


def test_pipe_initialization():
    """Test that the pipe initializes correctly."""
    pipe = Pipe()
    assert pipe is not None
    assert pipe.valves is not None


def test_pipe_has_valves():
    """Test that valves are properly configured."""
    pipe = Pipe()
    assert hasattr(pipe.valves, 'PROXY_URL')
    assert hasattr(pipe.valves, 'PROXY_API_KEY')
    assert hasattr(pipe.valves, 'TIMEOUT_SECONDS')
    assert hasattr(pipe.valves, 'DEBUG_MODE')


def test_pipes_method():
    """Test that pipes() returns the correct model list."""
    pipe = Pipe()
    models = pipe.pipes()

    assert isinstance(models, list)
    assert len(models) == 1
    assert models[0]['id'] == 'tutor-gpt'
    assert 'Bloom' in models[0]['name']


def test_default_proxy_url():
    """Test that default proxy URL is set correctly."""
    pipe = Pipe()
    assert 'localhost:8081' in pipe.valves.PROXY_URL or '8081' in pipe.valves.PROXY_URL


def test_timeout_default():
    """Test that timeout has a reasonable default."""
    pipe = Pipe()
    assert pipe.valves.TIMEOUT_SECONDS >= 60
    assert pipe.valves.TIMEOUT_SECONDS <= 600


if __name__ == '__main__':
    # Run basic tests
    print("Running Tutor-GPT Pipe tests...")

    try:
        test_pipe_initialization()
        print("✓ Pipe initialization test passed")

        test_pipe_has_valves()
        print("✓ Valves configuration test passed")

        test_pipes_method()
        print("✓ Pipes method test passed")

        test_default_proxy_url()
        print("✓ Default proxy URL test passed")

        test_timeout_default()
        print("✓ Timeout default test passed")

        print("\nAll tests passed! ✓")

    except AssertionError as e:
        print(f"\n✗ Test failed: {str(e)}")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Unexpected error: {str(e)}")
        sys.exit(1)
