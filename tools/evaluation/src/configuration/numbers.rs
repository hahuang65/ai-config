//! Compare decimal values without rounding through binary floating point.
//! Unknown numeric tokens stay untouched in the document, including huge exponents.

pub(super) fn equal(left: &str, right: &str) -> bool {
    normalized(left)
        .zip(normalized(right))
        .is_some_and(|(left, right)| left == right)
}

fn normalized(token: &str) -> Option<(bool, String, i128)> {
    let negative = token.starts_with('-');
    let unsigned = token.strip_prefix('-').unwrap_or(token);
    if !unsigned.as_bytes().first()?.is_ascii_digit() {
        return None;
    }
    let (coefficient, exponent) = unsigned.split_once(['e', 'E']).unwrap_or((unsigned, "0"));
    let (integer, fraction) = coefficient.split_once('.').unwrap_or((coefficient, ""));
    let digits = format!("{integer}{fraction}");
    let significant = digits.trim_start_matches('0');
    if significant.is_empty() {
        return Some((false, "0".to_owned(), 0));
    }
    let trimmed = significant.trim_end_matches('0');
    // Managed numbers come from serde_json::Value, so their exponents are bounded.
    // An unbounded nonzero exponent cannot equal a managed number. Identical raw
    // tokens are already handled by Document equality, without normalization.
    let exponent = exponent
        .parse::<i128>()
        .ok()?
        .checked_sub(fraction.len() as i128)?
        .checked_add((significant.len() - trimmed.len()) as i128)?;
    Some((negative, trimmed.to_owned(), exponent))
}
