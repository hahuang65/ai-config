use std::borrow::Cow;

const TAGS: &[&str] = &[
    "svg",
    "g",
    "defs",
    "desc",
    "marker",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "clipPath",
    "linearGradient",
    "radialGradient",
    "stop",
];

const ATTRIBUTES: &[&str] = &[
    "xmlns",
    "viewBox",
    "preserveAspectRatio",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "dx",
    "dy",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "width",
    "height",
    "d",
    "points",
    "transform",
    "fill",
    "fill-rule",
    "fill-opacity",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "opacity",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "text-anchor",
    "dominant-baseline",
    "alignment-baseline",
    "xml:space",
    "marker-start",
    "marker-mid",
    "marker-end",
    "markerWidth",
    "markerHeight",
    "markerUnits",
    "refX",
    "refY",
    "orient",
    "clip-path",
    "clipPathUnits",
    "gradientUnits",
    "gradientTransform",
    "spreadMethod",
    "offset",
    "stop-color",
    "stop-opacity",
    "role",
    "aria-label",
    "aria-describedby",
    "aria-labelledby",
    "aria-roledescription",
];

pub fn configure(builder: &mut ammonia::Builder<'static>) {
    builder.add_tags(TAGS);
    for tag in TAGS {
        builder.add_tag_attributes(tag, ATTRIBUTES);
    }
    builder.add_clean_content_tags(&[
        "foreignObject",
        "image",
        "use",
        "animate",
        "animateMotion",
        "animateTransform",
        "set",
        "discard",
        "metadata",
    ]);
}

pub fn attribute<'a>(element: &str, name: &str, value: &'a str) -> Option<Cow<'a, str>> {
    // Ammonia exposes local names, not namespaces. Guard paint values on all anchors
    // while retaining normal HTML link layout properties such as padding and display.
    if element == "a" && name == "style" {
        return Some(Cow::Owned(style(value, false)));
    }
    if !TAGS.contains(&element) {
        return Some(Cow::Borrowed(value));
    }
    if name == "xmlns" {
        return (value == "http://www.w3.org/2000/svg").then_some(Cow::Borrowed(value));
    }
    if name == "style" {
        return Some(Cow::Owned(style(value, true)));
    }
    if matches!(
        name,
        "fill" | "stroke" | "clip-path" | "marker-start" | "marker-mid" | "marker-end"
    ) && !paint(value)
    {
        return None;
    }
    Some(Cow::Borrowed(value))
}

fn style(source: &str, svg_properties_only: bool) -> String {
    source
        .split(';')
        .filter_map(|declaration| {
            let (name, value) = declaration.split_once(':')?;
            let name = name.trim();
            let value = value.trim();
            let valid_name = !name.is_empty()
                && name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte));
            let allowed = !svg_properties_only
                || name.starts_with("--")
                || ATTRIBUTES.contains(&name)
                || matches!(
                    name,
                    "color"
                        | "font"
                        | "max-width"
                        | "max-height"
                        | "min-width"
                        | "min-height"
                        | "letter-spacing"
                        | "word-spacing"
                        | "text-transform"
                        | "direction"
                        | "display"
                        | "visibility"
                );
            (valid_name && allowed && paint(value)).then(|| format!("{name}:{value}"))
        })
        .collect::<Vec<_>>()
        .join(";")
}

fn paint(value: &str) -> bool {
    // A deliberately small CSS value grammar avoids escaped/comment-obfuscated URLs.
    if !value.bytes().all(|byte| {
        byte.is_ascii_alphanumeric()
            || byte.is_ascii_whitespace()
            || b"-_#.,%()'\"+*/!".contains(&byte)
    }) || value.contains("/*")
    {
        return false;
    }
    let lower = value.to_ascii_lowercase();
    let mut remaining = lower.as_str();
    while let Some(start) = remaining.find("url(") {
        let Some(end) = remaining[start + 4..].find(')') else {
            return false;
        };
        let target = remaining[start + 4..start + 4 + end]
            .trim()
            .trim_matches(['\'', '"']);
        let Some(id) = target.strip_prefix('#') else {
            return false;
        };
        if id.is_empty()
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
        {
            return false;
        }
        remaining = &remaining[start + 5 + end..];
    }
    true
}
