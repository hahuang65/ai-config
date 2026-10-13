//! Shared syntactic validation for restricted command option/value pairs.
use anyhow::{Context, Result, ensure};
use std::{collections::BTreeMap, ffi::OsString};

pub fn parse<'a>(
    arguments: &'a [OsString],
    allowed: &[&str],
    label: &str,
    help: &str,
) -> Result<BTreeMap<&'a str, &'a str>> {
    ensure!(
        arguments.len().is_multiple_of(2),
        "{label} options need values; {help}"
    );
    let kind = label.to_ascii_lowercase();
    let mut fields = BTreeMap::new();
    for pair in arguments.as_chunks::<2>().0 {
        let name = pair[0]
            .to_str()
            .context(format!("{label} options must be text"))?;
        let value = pair[1]
            .to_str()
            .context(format!("{label} values must be text"))?;
        ensure!(allowed.contains(&name), "Unsupported {kind} option; {help}");
        ensure!(
            fields.insert(name, value).is_none(),
            "Duplicate {kind} option: {name}"
        );
    }
    Ok(fields)
}
