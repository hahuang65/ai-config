# Validate required skill front matter.
# File safety and UTF-8 checks stay in install.sh.
include "manifest";

def valid_skills:
  . as $files
  | ($files | keys) == (skills | sort)
    and all(skills[]; . as $name
      | ($files[$name] | capture("\\A---\\n(?<header>.*?)\\n---\\n(?<body>.*)\\z"; "m")
        | (.header | split("\n")) as $lines
        | [$lines[] | select(startswith("name: "))] == ["name: " + $name]
          and ([$lines[] | select(startswith("description: ")) | .[13:]] | length == 1
            and all(.[]; test("\\S") and length <= 1024)) and (.body | test("\\S"))) // false);
