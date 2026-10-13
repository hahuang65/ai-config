//! Preserve unknown JSON numbers exactly and reject ambiguous duplicate keys.
use anyhow::{Result, anyhow, ensure};
use serde::de::{self, MapAccess, Visitor};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Value, value::RawValue};
use std::fmt;

const MAX_DEPTH: usize = 128;

#[derive(Clone, Debug)]
pub(super) enum Document {
    Object(Vec<(String, Document)>),
    Array(Vec<Document>),
    Scalar(Box<RawValue>),
}

impl Document {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        let raw: Box<RawValue> =
            serde_json::from_slice(bytes).map_err(|_| anyhow!("Invalid JSON document"))?;
        Self::from_raw(raw, 0)
    }

    fn from_raw(raw: Box<RawValue>, depth: usize) -> Result<Self> {
        ensure!(
            depth <= MAX_DEPTH,
            "JSON document exceeds the supported nesting depth"
        );
        match raw.get().as_bytes()[0] {
            b'{' => {
                let Pairs(pairs) = serde_json::from_str(raw.get())
                    .map_err(|_| anyhow!("Invalid or duplicate JSON object keys"))?;
                Ok(Self::Object(
                    pairs
                        .into_iter()
                        .map(|(key, value)| Ok((key, Self::from_raw(value, depth + 1)?)))
                        .collect::<Result<_>>()?,
                ))
            }
            b'[' => {
                let values: Vec<Box<RawValue>> = serde_json::from_str(raw.get())?;
                Ok(Self::Array(
                    values
                        .into_iter()
                        .map(|value| Self::from_raw(value, depth + 1))
                        .collect::<Result<_>>()?,
                ))
            }
            _ => Ok(Self::Scalar(raw)),
        }
    }

    pub fn from_value(value: &Value) -> Result<Self> {
        Self::parse(&serde_json::to_vec(value)?)
    }

    pub fn empty() -> Self {
        Self::Object(Vec::new())
    }

    pub fn at(&self, path: &[String]) -> Result<Option<&Self>> {
        let Some((key, rest)) = path.split_first() else {
            return Ok(Some(self));
        };
        let Self::Object(pairs) = self else {
            anyhow::bail!("Managed settings parent must be an object");
        };
        match pairs.iter().find(|(name, _)| name == key) {
            Some((_, value)) => value.at(rest),
            None => Ok(None),
        }
    }

    pub fn set(&mut self, path: &[String], value: Option<Self>) -> Result<()> {
        let (key, rest) = path
            .split_first()
            .ok_or_else(|| anyhow!("Empty settings path"))?;
        let Self::Object(pairs) = self else {
            anyhow::bail!("Managed settings parent must be an object");
        };
        let position = pairs.iter().position(|(name, _)| name == key);
        if rest.is_empty() {
            match (position, value) {
                (Some(index), Some(value)) => pairs[index].1 = value,
                (Some(index), None) => {
                    pairs.remove(index);
                }
                (None, Some(value)) => pairs.push((key.clone(), value)),
                (None, None) => {}
            }
            return Ok(());
        }
        let index = match position {
            Some(index) => index,
            None if value.is_none() => return Ok(()),
            None => {
                pairs.push((key.clone(), Self::empty()));
                pairs.len() - 1
            }
        };
        pairs[index].1.set(rest, value)
    }
}

impl PartialEq for Document {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Object(left), Self::Object(right)) => {
                left.len() == right.len()
                    && left.iter().all(|(key, value)| {
                        right
                            .iter()
                            .any(|(name, other)| key == name && value == other)
                    })
            }
            (Self::Array(left), Self::Array(right)) => left == right,
            (Self::Scalar(left), Self::Scalar(right)) => {
                if left.get() == right.get() {
                    true
                } else if left.get().starts_with('"') && right.get().starts_with('"') {
                    serde_json::from_str::<String>(left.get()).ok()
                        == serde_json::from_str::<String>(right.get()).ok()
                } else {
                    super::numbers::equal(left.get(), right.get())
                }
            }
            _ => false,
        }
    }
}

impl Serialize for Document {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        match self {
            Self::Object(pairs) => {
                let mut map = serializer.serialize_map(Some(pairs.len()))?;
                for (key, value) in pairs {
                    map.serialize_entry(key, value)?;
                }
                map.end()
            }
            Self::Array(values) => values.serialize(serializer),
            Self::Scalar(value) => value.serialize(serializer),
        }
    }
}

struct Pairs(Vec<(String, Box<RawValue>)>);
impl<'de> Deserialize<'de> for Pairs {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        struct UniqueKeys;
        impl<'de> Visitor<'de> for UniqueKeys {
            type Value = Pairs;
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("an object with unique keys")
            }
            fn visit_map<M: MapAccess<'de>>(
                self,
                mut map: M,
            ) -> std::result::Result<Pairs, M::Error> {
                let mut pairs = Vec::new();
                while let Some((key, value)) = map.next_entry::<String, Box<RawValue>>()? {
                    if pairs.iter().any(|(name, _)| name == &key) {
                        return Err(de::Error::custom("Duplicate JSON key"));
                    }
                    pairs.push((key, value));
                }
                Ok(Pairs(pairs))
            }
        }
        deserializer.deserialize_map(UniqueKeys)
    }
}

pub(super) fn object(bytes: &[u8]) -> Result<Document> {
    let document = Document::parse(bytes)?;
    ensure!(
        matches!(document, Document::Object(_)),
        "Settings must be a JSON object"
    );
    Ok(document)
}
