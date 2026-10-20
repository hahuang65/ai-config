use crate::{paths::Result, store::Store};
use rusqlite::{Transaction, params};

pub fn validate(transaction: &Transaction<'_>, ticket: &str) -> Result<()> {
    let valid: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM feedback_ticket WHERE id=1 AND ticket=?1 AND expires>unixepoch())",
        [ticket], |row| row.get(0),
    ).map_err(|_| "Cannot validate automatic attachment receipt.")?;
    if !valid {
        return Err("Automatic attachment receipt is invalid or expired. Open the artifact again.");
    }
    Ok(())
}

impl Store {
    pub fn feedback_ticket(&mut self) -> Result<String> {
        let ticket = format!("{:032x}", rand::random::<u128>());
        self.0
            .execute(
                "INSERT INTO feedback_ticket(id,ticket,expires) VALUES(1,?1,unixepoch()+300)
            ON CONFLICT(id) DO UPDATE SET ticket=excluded.ticket,expires=excluded.expires",
                params![ticket],
            )
            .map_err(|_| "Cannot create automatic attachment receipt.")?;
        Ok(ticket)
    }
}
