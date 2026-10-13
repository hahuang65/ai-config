#!/usr/bin/env python3
"""Install only a symlink; leave any unrelated executable untouched."""
import argparse
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Install wt at ~/.local/bin/wt without changing existing tools.")
    parser.add_argument("--uninstall", action="store_true", help="Remove only this repository's wt link")
    args = parser.parse_args()
    source = Path(__file__).resolve().parent / "bin/wt"
    destination = Path.home() / ".local/bin/wt"
    if destination.exists() or destination.is_symlink():
        if not destination.is_symlink() or destination.readlink() != source:
            parser.exit(1, f"Refusing to replace an unrelated file at {destination}.\n")
        if args.uninstall:
            destination.unlink()
    elif not args.uninstall:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.symlink_to(source)
    print(f"{'Removed' if args.uninstall else 'Installed'} {destination}")


if __name__ == "__main__":
    main()
