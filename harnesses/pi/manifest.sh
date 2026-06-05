# pi harness module manifest — SLOT ONLY (ADR-0010, ADR-0011).
#
# pi (badlogic/pi-coding-agent) is a committed but DEFERRED harness. This
# manifest documents the module shape so that adding pi later is filling in
# install_module plus a tier-A guard adapter (it has programmable TS hooks) —
# not another restructure. While `harness_pending=true`, the install loop
# scaffolds nothing for pi.

config_root="$HOME/.pi/agent"
consumed_categories=(skills commands agents rules)

# Pending: enforcement (the guard adapter) and runtime config are not built
# yet. The install loop treats this module as a no-op until flipped to false.
harness_pending=true

instruction_target=""

install_module() {
  : # deferred — pi enforcement is a follow-up effort
}
