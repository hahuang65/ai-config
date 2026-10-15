# Lossless settings documents. jq numbers alone lose -0 and very large exponents.
# Every node is typed, so user objects can never impersonate an internal number.
def tokens:
  [scan("\"(?:[^\"\\\\]|\\\\.)*\"|-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null|[ \\t\\r\\n]+|.")
   | select(test("^[ \\t\\r\\n]+$") | not)];

def check_tokens:
  . as $tokens
  | if all(.[]; test("^(?:\".*\"|-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null|[{}\\[\\],:])$"))
    then . else error("Invalid JSON token") end
  | reduce range(0; length) as $i ([];
      if $tokens[$i] == "{" or $tokens[$i] == "[" then
        if length >= 128 then error("JSON nesting is too deep") else . + [{}] end
      elif $tokens[$i] == "}" or $tokens[$i] == "]" then .[:-1]
      elif $tokens[$i + 1] == ":" then
        ($tokens[$i] | fromjson) as $key
        | if .[-1][$key] then error("Duplicate JSON key") else .[-1][$key] = true end
      else . end)
  | $tokens;

def typed($marker):
  if type == "object" then
    if keys == [$marker] then {t: "number", v: .[$marker]}
    else {t: "object", v: with_entries(.value |= typed($marker))} end
  elif type == "array" then {t: "array", v: map(typed($marker))}
  else {t: type, v: .} end;

def decode_document:
  if utf8bytelength > 16777216 then error("JSON document exceeds 16 MiB") else . end
  | tokens | check_tokens
  | . as $tokens
  | [range(0; length) as $i | select($tokens[$i + 1] == ":")
      | $tokens[$i] | fromjson] as $keys
  | (first(range(0; 128) as $i | ("$ai_number" + ("_" * $i)) as $candidate
      | select(($keys | index($candidate)) == null) | $candidate)
      // error("Cannot encode JSON numbers safely")) as $marker
  | map(if test("^-?[0-9]") then ({($marker): .} | tojson) else . end)
  | join("") | fromjson | typed($marker);

def encode_document:
  if .t == "number" then .v
  elif .t == "object" then
    "{" + ([.v | to_entries[] | (.key | tojson) + ":" + (.value | encode_document)] | join(",")) + "}"
  elif .t == "array" then "[" + ([.v[] | encode_document] | join(",")) + "]"
  else .v | tojson end;

def numeric_key:
  capture("^(?<negative>-?)(?<integer>[0-9]+)(?:\\.(?<fraction>[0-9]+))?(?:[eE](?<exponent>[+-]?[0-9]+))?$")
  | (.integer + (.fraction // "") | sub("^0+"; "")) as $digits
  | if $digits == "" then [false, "0", 0]
    elif ((.exponent // "0") | length) > 15 then null
    else ($digits | sub("0+$"; "")) as $trimmed
      | [.negative == "-", $trimmed,
          ((.exponent // "0" | tonumber) - (.fraction // "" | length)
           + ($digits | length) - ($trimmed | length))] end;

def equivalent($left; $right):
  if $left == $right then true
  elif $left == null or $right == null or $left.t != $right.t then false
  elif $left.t == "number" then
    ($left.v | numeric_key) as $key | $key != null and $key == ($right.v | numeric_key)
  elif $left.t == "object" then
    ($left.v | keys) == ($right.v | keys)
    and all($left.v | keys[]; . as $key | equivalent($left.v[$key]; $right.v[$key]))
  elif $left.t == "array" then
    ($left.v | length) == ($right.v | length)
    and all(range(0; $left.v | length); . as $i | equivalent($left.v[$i]; $right.v[$i]))
  else false end;

# Claims keep their values typed; native jq arithmetic never touches user numbers.
def claims:
  if .t != "array" then error("Settings claims must be an array") else . end
  | [.v[] | .v as $claim
      | if $claim.path.t != "array" or ($claim.path.v | length) == 0
          or (all($claim.path.v[]; .t == "string" and (.v | length) > 0) | not)
          or (["value", "array_entry"] | index($claim.mode.v)) == null
        then error("Invalid settings claim") else
          {destination: $claim.destination.v, path: [$claim.path.v[].v],
           mode: $claim.mode.v, value: $claim.value} end];

def at_path($path):
  reduce $path[] as $key (.;
    if . == null then null
    elif .t != "object" then error("Settings path crosses a non-object")
    else .v[$key] end);

def put_path($path; $value):
  if ($path | length) == 0 then $value
  elif . == null and $value == null then null
  else (. // {t: "object", v: {}})
    | if .t != "object" then error("Settings path crosses a non-object") else . end
    | (.v[$path[0]] | put_path($path[1:]; $value)) as $child
    | if $child == null then .v |= del(.[$path[0]]) else .v[$path[0]] = $child end
  end;

def includes_value($entries; $value): any($entries[]; equivalent(.; $value));

def merge_array($current; $previous; $desired):
  if $current != null and $current.t != "array" then error("Managed field must be an array") else . end
  | ($current.v // []) as $entries
  | if $current != null and (all($previous[]; . as $owned
       | [$entries[] | select(equivalent(.; $owned))] | length == 1) | not)
    then error("Missing, modified, or duplicated owned settings entry") else . end
  | if all($desired[]; . as $new | includes_value($previous; $new)
      or (includes_value($entries; $new) | not)) then .
    else error("Unowned settings entry conflicts with installation") end
  | [$entries[] | . as $entry | select((includes_value($previous; $entry) | not)
      or includes_value($desired; $entry))] as $retained
  | reduce $desired[] as $entry ($retained;
      if includes_value(.; $entry) then . else . + [$entry] end)
  | if $current == null and length == 0 then null else {t: "array", v: .} end;

def validate_claims:
  . as $all | range(0; length) as $i | range(0; $i) as $j
  | $all[$i] as $a | $all[$j] as $b
  | select($a.destination == $b.destination)
  | select($a.path[:($b.path | length)] == $b.path or $b.path[:($a.path | length)] == $a.path)
  | if $a.path == $b.path and $a.mode == "array_entry" and $b.mode == "array_entry"
      and (equivalent($a.value; $b.value) | not) then empty
    else error("Duplicate or overlapping settings ownership") end;

def merge_settings($current; $previous; $desired):
  if $current.t != "object" then error("Settings must be an object") else . end
  | [$previous | validate_claims] | [$desired | validate_claims]
  | ([$previous[].path, $desired[].path] | unique) as $paths
  | reduce $paths[] as $path ($current;
      [$previous[] | select(.path == $path)] as $old
      | [$desired[] | select(.path == $path)] as $new
      | ($old + $new | map(.mode) | unique) as $modes
      | if ($modes | length) != 1 then error("Settings ownership mode changed") else . end
      | ($current | at_path($path)) as $before
      | (if $modes[0] == "array_entry" then
           merge_array($before; [$old[].value]; [$new[].value])
         elif $before == null or equivalent($before; $old[0].value) then $new[0].value
         else error("Unowned or modified settings field") end) as $after
      | put_path($path; $after));

# Preserve exact bytes on a no-op; only changed documents are serialized.
def plan_settings($previous; $desired; $destination):
  . as $original | decode_document as $current
  | ($previous | decode_document | .v.settings // {t: "array", v: []} | claims
      | map(select(.destination == $destination))) as $old
  | ($desired | decode_document | .v.settings // {t: "array", v: []} | claims
      | map(select(.destination == $destination))) as $new
  | merge_settings($current; $old; $new) as $merged
  | if equivalent($current; $merged) then $original else ($merged | encode_document) + "\n" end;
