use std::process::Command;

#[test]
fn help_uses_the_verb_led_command_name() {
    let output = Command::new(env!("CARGO_BIN_EXE_review-artifact"))
        .arg("--help")
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("Usage: review-artifact ")
    );
    assert!(output.stderr.is_empty());
}
