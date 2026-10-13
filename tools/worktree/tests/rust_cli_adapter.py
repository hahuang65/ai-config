"""Run the Rust binary where original tests explicitly invoke Python."""
import os
from pathlib import Path
import sys

binary = os.environ.get("WT_RUST_BINARY", str(Path(__file__).resolve().parents[1] / "target/debug/wt"))
os.execv(binary, [binary, *sys.argv[1:]])
