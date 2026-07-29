//! Cangjie 1.0.5 native extraction.
//!
//! This walker mirrors `src/extraction/languages/cangjie.ts` and the Cangjie
//! branches in `tree-sitter.ts`. The grammar is compiled from the same
//! generated parser/scanner that produce the vendored WASM artifact.

use crate::buffers::{
    build_meta, edge_kind_index, node_kind_index, Arena, BoolFlags, EdgeRow, EmitOut, NodeRow,
    RefRow, StrRef, Tables, FLAG_IS_EXPORTED, FLAG_IS_STATIC, NONE, NONE_STR,
};
use crate::docstring::preceding_docstring;
use crate::ids;
use crate::textutil as util;
use std::collections::HashSet;
use tree_sitter::{Node, Parser};

#[derive(Default)]
struct Extra {
    docstring: Option<String>,
    signature: Option<String>,
    visibility: Option<u8>,
    is_exported: Option<bool>,
    is_static: Option<bool>,
    decorators: Vec<String>,
    type_parameters: Vec<String>,
    return_type: Option<String>,
}

struct Scope {
    row: u32,
    kind: &'static str,
    name: String,
}

struct ImportEntry {
    module: String,
    alias: Option<String>,
}

struct Walker<'t> {
    src: &'t str,
    file_path: &'t str,
    line_starts: Vec<usize>,
    arena: Arena,
    tables: Tables,
    stack: Vec<Scope>,
}

pub fn extract(file_path: &str, source: &str) -> Result<EmitOut, String> {
    let grammar = crate::langs::grammar_for("cangjie").ok_or("no cangjie grammar")?;
    let started = std::time::Instant::now();
    let mut parser = Parser::new();
    parser
        .set_language(&grammar)
        .map_err(|e| format!("set_language(cangjie) failed: {e}"))?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| "parser returned null tree".to_string())?;
    if tree.root_node().has_error() {
        return Err("defer: Cangjie parse tree contains errors".to_string());
    }

    let mut walker = Walker {
        src: source,
        file_path,
        line_starts: util::line_starts(source),
        arena: Arena::default(),
        tables: Tables::default(),
        stack: Vec::new(),
    };

    let line_count = source.bytes().filter(|byte| *byte == b'\n').count() as u32 + 1;
    let file_name = file_path.rsplit(['/', '\\']).next().unwrap_or(file_path);
    let mut file_flags = BoolFlags::default();
    file_flags.set(FLAG_IS_EXPORTED, false);
    let file_id = walker.arena.put(&ids::file_node_id(file_path));
    let file_name_ref = walker.arena.put(file_name);
    let file_qn_ref = walker.arena.put(file_path);
    walker.tables.push_node(&NodeRow {
        kind: node_kind_index("file").unwrap(),
        visibility: 0,
        flags: file_flags,
        start_line: 1,
        end_line: line_count,
        start_column: 0,
        end_column: 0,
        name: file_name_ref,
        qualified_name: file_qn_ref,
        id: file_id,
        docstring: NONE_STR,
        signature: NONE_STR,
        decorators: NONE_STR,
        type_parameters: NONE_STR,
        return_type: NONE_STR,
        extra_json: NONE_STR,
    });
    walker.stack.push(Scope {
        row: 0,
        kind: "file",
        name: file_name.to_string(),
    });

    let root = tree.root_node();
    let mut package_pushed = false;
    for i in 0..root.named_child_count() {
        let Some(child) = root.named_child(i) else {
            continue;
        };
        if child.kind() != "packageDeclaration" {
            continue;
        }
        let package = child
            .child_by_field_name("packageName")
            .or_else(|| walker.first_direct_kind(child, &["packageName"]));
        if let Some(package) = package {
            let name = walker.text(package).trim().to_string();
            if !name.is_empty() {
                if let Some(row) = walker.create_node("namespace", &name, child, Extra::default()) {
                    walker.stack.push(Scope {
                        row,
                        kind: "namespace",
                        name,
                    });
                    package_pushed = true;
                }
            }
        }
        break;
    }

    walker.visit_node(root);
    if package_pushed {
        walker.stack.pop();
    }
    walker.stack.pop();

    let duration_ms = started.elapsed().as_secs_f64() * 1000.0;
    let meta = build_meta(&walker.tables, walker.arena.len(), NONE_STR, duration_ms);
    Ok(EmitOut {
        meta,
        nodes: walker.tables.nodes,
        edges: walker.tables.edges,
        refs: walker.tables.refs,
        arena: walker.arena.into_vec(),
    })
}

impl<'t> Walker<'t> {
    fn text(&self, node: Node) -> &'t str {
        &self.src[node.byte_range()]
    }

    fn line_of(&self, node: Node) -> u32 {
        node.start_position().row as u32 + 1
    }

    fn column_of(&self, node: Node) -> u32 {
        util::col16(
            self.src,
            &self.line_starts,
            node.start_position().row,
            node.start_byte(),
        )
    }

    fn end_column_of(&self, node: Node) -> u32 {
        util::col16(
            self.src,
            &self.line_starts,
            node.end_position().row,
            node.end_byte(),
        )
    }

    fn top_row(&self) -> u32 {
        self.stack.last().map(|scope| scope.row).unwrap_or(0)
    }

    fn inside_class_like(&self) -> bool {
        self.stack.last().is_some_and(|scope| {
            matches!(
                scope.kind,
                "class" | "struct" | "interface" | "trait" | "enum" | "module" | "extension"
            )
        })
    }

    fn first_direct_kind(&self, node: Node<'t>, kinds: &[&str]) -> Option<Node<'t>> {
        (0..node.named_child_count())
            .filter_map(|i| node.named_child(i))
            .find(|child| kinds.contains(&child.kind()))
    }

    fn first_descendant_kind(&self, node: Node<'t>, kinds: &[&str]) -> Option<Node<'t>> {
        if kinds.contains(&node.kind()) {
            return Some(node);
        }
        for i in 0..node.named_child_count() {
            let Some(child) = node.named_child(i) else {
                continue;
            };
            if let Some(found) = self.first_descendant_kind(child, kinds) {
                return Some(found);
            }
        }
        None
    }

    fn body_of(&self, node: Node<'t>) -> Option<Node<'t>> {
        self.first_direct_kind(
            node,
            &[
                "block",
                "classBody",
                "interfaceBody",
                "structBody",
                "enumBody",
                "extendBody",
            ],
        )
    }

    fn modifier_text(&self, node: Node) -> &str {
        self.first_direct_kind(node, &["modifiers"])
            .map(|modifiers| self.text(modifiers))
            .unwrap_or("")
    }

    /// Cangjie declaration annotations are parsed as `macroExpression`
    /// siblings (`@Test`, `@TestCase`, lifecycle macros, parameterized tests).
    /// Keep the macro names on the declaration node so native extraction
    /// matches the WASM extractor's `extractModifiers` hook.
    fn declaration_macro_names(&self, node: Node<'t>) -> Vec<String> {
        let mut names = Vec::new();
        let mut previous = node.prev_named_sibling();
        while let Some(macro_node) = previous {
            if macro_node.kind() != "macroExpression" {
                break;
            }
            if let Some(name_node) = self.first_direct_kind(macro_node, &["macroName"]) {
                let name = self.text(name_node).trim();
                if !name.is_empty() {
                    names.push(name.to_string());
                }
            }
            previous = macro_node.prev_named_sibling();
        }
        names.reverse();
        let mut unique_names = Vec::new();
        for name in names {
            if !unique_names.contains(&name) {
                unique_names.push(name);
            }
        }
        unique_names
    }

    fn visibility_of(&self, node: Node) -> u8 {
        let modifiers = self.modifier_text(node);
        if modifiers
            .split_whitespace()
            .any(|part| part == "public" || part == "sealed")
        {
            return 1;
        }
        if modifiers.split_whitespace().any(|part| part == "private") {
            return 2;
        }
        if modifiers.split_whitespace().any(|part| part == "protected") {
            return 3;
        }
        if modifiers.split_whitespace().any(|part| part == "internal") {
            return 4;
        }
        let mut parent = node.parent();
        while let Some(candidate) = parent {
            if candidate.kind() == "interfaceDefinition" {
                return 1;
            }
            if matches!(
                candidate.kind(),
                "classDefinition" | "structDefinition" | "enumDefinition" | "extendDefinition"
            ) {
                break;
            }
            parent = candidate.parent();
        }
        4
    }

    fn declaration_type_parameters_node(&self, node: Node<'t>) -> Option<Node<'t>> {
        if node.kind() == "extendDefinition" {
            let extend_type = self.first_direct_kind(node, &["extendType"])?;
            let target_name =
                self.first_direct_kind(extend_type, &["identifier", "scoped_identifier"]);
            return (0..extend_type.named_child_count())
                .filter_map(|index| extend_type.named_child(index))
                .find(|child| {
                    child.kind() == "typeParameters"
                        && target_name.is_none_or(|target| child.end_byte() <= target.start_byte())
                });
        }

        let name_kind = match node.kind() {
            "functionDefinition" => "funcName",
            "classDefinition" => "className",
            "interfaceDefinition" => "interfaceName",
            "structDefinition" => "structName",
            "enumDefinition" => "enumName",
            "typeAlias" => "typeAliasName",
            "propertyDefinition" => "propertyName",
            "macroDefinition" => "macroName",
            _ => return None,
        };
        let name = self.first_direct_kind(node, &[name_kind])?;
        let first_supertype = self.first_direct_kind(node, &["superOrInterface"]);
        (0..node.named_child_count())
            .filter_map(|index| node.named_child(index))
            .find(|child| {
                child.kind() == "typeParameters"
                    && child.start_byte() >= name.end_byte()
                    && first_supertype
                        .is_none_or(|supertype| child.end_byte() <= supertype.start_byte())
            })
    }

    fn declaration_type_parameters(&self, node: Node<'t>) -> Vec<String> {
        let Some(parameters) = self.declaration_type_parameters_node(node) else {
            return Vec::new();
        };
        let mut names = Vec::new();
        for i in 0..parameters.named_child_count() {
            let Some(child) = parameters.named_child(i) else {
                continue;
            };
            if child.kind() == "identifier" {
                let name = self.text(child).trim();
                if !name.is_empty() {
                    names.push(name.to_string());
                }
            }
        }
        names
    }

    fn signature_of(&self, node: Node) -> Option<String> {
        let type_parameters = self
            .declaration_type_parameters_node(node)
            .map(|part| self.text(part).trim().to_string())
            .unwrap_or_default();
        let parameters = self
            .first_direct_kind(node, &["parameterList", "primaryInitParamList"])
            .map(|part| self.text(part).trim().to_string());
        let return_type = self
            .first_direct_kind(node, &["returnType"])
            .map(|part| self.text(part).trim().to_string())
            .unwrap_or_default();
        let constraints = self
            .first_direct_kind(node, &["genericConstraints"])
            .map(|part| self.text(part).trim().to_string())
            .unwrap_or_default();

        if node.kind() == "typeAlias" {
            let target = node
                .child_by_field_name("type")
                .map(|part| self.text(part).trim().to_string())?;
            let mut signature = format!("{type_parameters} = {target}").trim().to_string();
            if !constraints.is_empty() {
                signature.push(' ');
                signature.push_str(&constraints);
            }
            return Some(signature);
        }
        if parameters.is_none()
            && type_parameters.is_empty()
            && constraints.is_empty()
            && return_type.is_empty()
        {
            return None;
        }
        let mut signature = type_parameters;
        if let Some(parameters) = parameters {
            signature.push_str(&parameters);
            signature.push_str(&return_type);
        }
        if !constraints.is_empty() {
            if !signature.is_empty() {
                signature.push(' ');
            }
            signature.push_str(&constraints);
        }
        (!signature.is_empty()).then_some(signature)
    }

    fn return_type_of(&self, node: Node) -> Option<String> {
        let raw = self
            .first_direct_kind(node, &["returnType"])
            .map(|part| self.text(part).trim())?;
        let mut value = raw.trim_start_matches(':').trim();
        value = value.trim_start_matches(['?', '!']).trim();
        if value.starts_with('(') {
            return None;
        }
        value = value.split('<').next().unwrap_or(value).trim();
        value = value.rsplit('.').next().unwrap_or(value).trim();
        if value.is_empty()
            || matches!(
                value,
                "Unit"
                    | "Nothing"
                    | "Bool"
                    | "Rune"
                    | "String"
                    | "Int8"
                    | "Int16"
                    | "Int32"
                    | "Int64"
                    | "IntNative"
                    | "UInt8"
                    | "UInt16"
                    | "UInt32"
                    | "UInt64"
                    | "UIntNative"
                    | "Float16"
                    | "Float32"
                    | "Float64"
            )
        {
            return None;
        }
        let mut chars = value.chars();
        let first = chars.next()?;
        if !(first == '_' || first.is_alphabetic())
            || !chars.all(|character| character == '_' || character.is_alphanumeric())
        {
            return None;
        }
        Some(value.to_string())
    }

    fn declaration_extra(&self, node: Node) -> Extra {
        let visibility = self.visibility_of(node);
        Extra {
            docstring: preceding_docstring(node, self.src),
            signature: self.signature_of(node),
            visibility: Some(visibility),
            is_exported: Some(visibility == 1),
            is_static: matches!(
                node.kind(),
                "functionDefinition"
                    | "mainDefinition"
                    | "macroDefinition"
                    | "operatorFunctionDefinition"
                    | "init"
                    | "staticInit"
                    | "finalizer"
            )
            .then(|| {
                node.kind() == "staticInit"
                    || self
                        .modifier_text(node)
                        .split_whitespace()
                        .any(|part| part == "static")
            }),
            decorators: self.declaration_macro_names(node),
            type_parameters: self.declaration_type_parameters(node),
            return_type: self.return_type_of(node),
        }
    }

    fn create_node(
        &mut self,
        kind: &'static str,
        name: &str,
        node: Node<'t>,
        extra: Extra,
    ) -> Option<u32> {
        if name.is_empty() || name == "<anonymous>" {
            return None;
        }
        let start_line = self.line_of(node);
        let id = ids::node_id(self.file_path, kind, name, start_line);
        let mut qualified_parts: Vec<&str> = self
            .stack
            .iter()
            .filter(|scope| scope.kind != "file")
            .map(|scope| scope.name.as_str())
            .collect();
        qualified_parts.push(name);
        let qualified_name = qualified_parts.join("::");

        let mut flags = BoolFlags::default();
        if let Some(value) = extra.is_exported {
            flags.set(FLAG_IS_EXPORTED, value);
        }
        if let Some(value) = extra.is_static {
            flags.set(FLAG_IS_STATIC, value);
        }
        let name_ref = self.arena.put(name);
        let qualified_ref = self.arena.put(&qualified_name);
        let id_ref = self.arena.put(&id);
        let doc_ref = self.put_optional(extra.docstring.as_deref());
        let signature_ref = self.put_optional(extra.signature.as_deref());
        let decorators_ref = self.arena.put_list(&extra.decorators);
        let type_parameters_ref = self.arena.put_list(&extra.type_parameters);
        let return_type_ref = self.put_optional(extra.return_type.as_deref());
        let row = self.tables.push_node(&NodeRow {
            kind: node_kind_index(kind)?,
            visibility: extra.visibility.unwrap_or(0),
            flags,
            start_line,
            end_line: node.end_position().row as u32 + 1,
            start_column: self.column_of(node),
            end_column: self.end_column_of(node),
            name: name_ref,
            qualified_name: qualified_ref,
            id: id_ref,
            docstring: doc_ref,
            signature: signature_ref,
            decorators: decorators_ref,
            type_parameters: type_parameters_ref,
            return_type: return_type_ref,
            extra_json: NONE_STR,
        });
        self.tables.push_edge(&EdgeRow {
            source_idx: self.top_row(),
            target_idx: row,
            kind: edge_kind_index("contains").unwrap(),
            provenance: 0,
            line: NONE,
            column: NONE,
            metadata_json: NONE_STR,
            source_id_str: NONE_STR,
            target_id_str: NONE_STR,
        });
        Some(row)
    }

    fn put_optional(&mut self, value: Option<&str>) -> StrRef {
        value.map(|text| self.arena.put(text)).unwrap_or(NONE_STR)
    }

    fn push_ref_at(&mut self, from: u32, name: &str, kind: &str, node: Node) {
        self.push_ref_with_candidates(from, name, kind, node, &[]);
    }

    fn push_ref_with_candidates(
        &mut self,
        from: u32,
        name: &str,
        kind: &str,
        node: Node,
        candidates: &[String],
    ) {
        if name.is_empty() {
            return;
        }
        let reference_name = self.arena.put(name);
        let candidates = self.arena.put_list(candidates);
        self.tables.push_ref(&RefRow {
            from_idx: from,
            kind: edge_kind_index(kind).unwrap(),
            line: self.line_of(node),
            column: self.column_of(node),
            reference_name,
            candidates,
            from_id_str: NONE_STR,
        });
    }

    fn extract_name(&self, node: Node) -> String {
        if let Some(name) = node.child_by_field_name("name") {
            return self.text(name).trim().to_string();
        }
        let child_kind = match node.kind() {
            "functionDefinition" => Some("funcName"),
            "classDefinition" => Some("className"),
            "interfaceDefinition" => Some("interfaceName"),
            "structDefinition" => Some("structName"),
            "enumDefinition" => Some("enumName"),
            "typeAlias" => Some("typeAliasName"),
            "propertyDefinition" => Some("propertyName"),
            "macroDefinition" => Some("macroName"),
            _ => None,
        };
        if let Some(kind) = child_kind {
            if let Some(name) = self.first_direct_kind(node, &[kind]) {
                return self.text(name).trim().to_string();
            }
        }
        match node.kind() {
            "mainDefinition" => "main".to_string(),
            "init" | "staticInit" => "init".to_string(),
            "finalizer" => "~init".to_string(),
            "operatorFunctionDefinition" => self
                .first_direct_kind(node, &["operator"])
                .map(|operator| format!("operator{}", self.text(operator).trim()))
                .unwrap_or_else(|| "operator".to_string()),
            "extendDefinition" => self
                .first_direct_kind(node, &["extendType"])
                .map(|target| {
                    let mut raw = self.text(target).trim();
                    // A generic extension spells its declaration parameters
                    // before the target (`<T> Foo<T>`). Skip that prefix, then
                    // remove target type arguments exactly like the WASM hook.
                    if raw.starts_with('<') {
                        if let Some(end) = raw.find('>') {
                            raw = raw[end + 1..].trim();
                        }
                    }
                    raw.split('<').next().unwrap_or(raw).trim().to_string()
                })
                .unwrap_or_default(),
            _ => String::new(),
        }
    }

    fn visit_node(&mut self, node: Node<'t>) {
        let kind = node.kind();
        let mut skip_children = false;
        match kind {
            "packageDeclaration" => return,
            "functionDefinition"
            | "mainDefinition"
            | "macroDefinition"
            | "operatorFunctionDefinition" => {
                self.extract_function_like(node);
                skip_children = true;
            }
            "init" | "staticInit" | "finalizer" => {
                self.extract_method(node);
                skip_children = true;
            }
            "classDefinition" => {
                self.extract_type(node, "class");
                skip_children = true;
            }
            "interfaceDefinition" => {
                self.extract_type(node, "interface");
                skip_children = true;
            }
            "structDefinition" => {
                self.extract_type(node, "struct");
                skip_children = true;
            }
            "enumDefinition" => {
                self.extract_enum(node);
                skip_children = true;
            }
            "extendDefinition" => {
                self.extract_type(node, "extension");
                skip_children = true;
            }
            "typeAlias" => {
                self.extract_type_alias(node);
                skip_children = true;
            }
            "primaryInit" => {
                self.extract_primary_init(node);
                skip_children = true;
            }
            "propertyDefinition" => {
                self.extract_property(node);
                skip_children = true;
            }
            "variableDeclaration" => {
                self.extract_variable(node);
                skip_children = true;
            }
            "importList" => {
                self.extract_imports(node);
                skip_children = true;
            }
            "callSuffix" | "trailingLambdaExpression" => self.extract_call(node),
            "binaryExpression" | "unaryExpression" | "indexAccess" => {
                self.extract_operator_call(node)
            }
            "fieldAccess" => self.extract_field_read(node),
            _ => {}
        }
        if !skip_children {
            for i in 0..node.named_child_count() {
                if let Some(child) = node.named_child(i) {
                    self.visit_node(child);
                }
            }
        }
    }

    fn walk_body(&mut self, node: Node<'t>) {
        match node.kind() {
            "callSuffix" | "trailingLambdaExpression" => self.extract_call(node),
            "binaryExpression" | "unaryExpression" | "indexAccess" => {
                self.extract_operator_call(node)
            }
            "fieldAccess" => self.extract_field_read(node),
            "functionDefinition"
            | "mainDefinition"
            | "macroDefinition"
            | "operatorFunctionDefinition" => {
                self.extract_function_like(node);
                return;
            }
            "classDefinition" => {
                self.extract_type(node, "class");
                return;
            }
            "interfaceDefinition" => {
                self.extract_type(node, "interface");
                return;
            }
            "structDefinition" => {
                self.extract_type(node, "struct");
                return;
            }
            "enumDefinition" => {
                self.extract_enum(node);
                return;
            }
            "extendDefinition" => {
                self.extract_type(node, "extension");
                return;
            }
            _ => {}
        }
        for i in 0..node.named_child_count() {
            if let Some(child) = node.named_child(i) {
                self.walk_body(child);
            }
        }
    }

    fn extract_function_like(&mut self, node: Node<'t>) {
        if self.inside_class_like() {
            self.extract_method(node);
            return;
        }
        let name = self.extract_name(node);
        let extra = self.declaration_extra(node);
        let Some(row) = self.create_node("function", &name, node, extra) else {
            if let Some(body) = self.body_of(node) {
                self.walk_body(body);
            }
            return;
        };
        self.stack.push(Scope {
            row,
            kind: "function",
            name,
        });
        if let Some(body) = self.body_of(node) {
            self.walk_body(body);
        }
        self.stack.pop();
    }

    fn extract_method(&mut self, node: Node<'t>) {
        if !self.inside_class_like() {
            self.extract_function_like(node);
            return;
        }
        let name = self.extract_name(node);
        let extra = self.declaration_extra(node);
        let Some(row) = self.create_node("method", &name, node, extra) else {
            return;
        };
        self.stack.push(Scope {
            row,
            kind: "method",
            name,
        });
        if let Some(body) = self.body_of(node) {
            self.walk_body(body);
        }
        self.stack.pop();
    }

    fn extract_type(&mut self, node: Node<'t>, kind: &'static str) {
        let Some(body) = self.body_of(node) else {
            return;
        };
        let name = self.extract_name(node);
        let extra = self.declaration_extra(node);
        let Some(row) = self.create_node(kind, &name, node, extra) else {
            return;
        };
        if kind == "extension" {
            self.push_ref_at(row, &name, "references", node);
        }
        self.extract_inheritance(node, row);
        self.stack.push(Scope { row, kind, name });
        for i in 0..body.named_child_count() {
            if let Some(child) = body.named_child(i) {
                self.visit_node(child);
            }
        }
        self.stack.pop();
    }

    fn extract_enum(&mut self, node: Node<'t>) {
        let Some(body) = self.body_of(node) else {
            return;
        };
        let name = self.extract_name(node);
        let extra = self.declaration_extra(node);
        let visibility = extra.visibility;
        let exported = extra.is_exported;
        let Some(row) = self.create_node("enum", &name, node, extra) else {
            return;
        };
        self.extract_inheritance(node, row);
        self.stack.push(Scope {
            row,
            kind: "enum",
            name,
        });
        for i in 0..body.named_child_count() {
            let Some(child) = body.named_child(i) else {
                continue;
            };
            if child.kind() == "enumConstructor" {
                let member_name = child
                    .child_by_field_name("name")
                    .or_else(|| self.first_descendant_kind(child, &["identifier"]))
                    .map(|name| self.text(name).trim().to_string())
                    .unwrap_or_default();
                let signature = child
                    .child_by_field_name("payload")
                    .or_else(|| self.first_direct_kind(child, &["enumPayload"]))
                    .map(|payload| self.text(payload).trim().to_string());
                self.create_node(
                    "enum_member",
                    &member_name,
                    child,
                    Extra {
                        signature,
                        visibility,
                        is_exported: exported,
                        ..Extra::default()
                    },
                );
            } else {
                self.visit_node(child);
            }
        }
        self.stack.pop();
    }

    fn extract_type_alias(&mut self, node: Node<'t>) {
        let name = self.extract_name(node);
        let extra = self.declaration_extra(node);
        self.create_node("type_alias", &name, node, extra);
    }

    fn extract_primary_init(&mut self, node: Node<'t>) {
        if let Some(parameters) = self.first_direct_kind(node, &["primaryInitParamList"]) {
            for i in 0..parameters.named_child_count() {
                let Some(member) = parameters.named_child(i) else {
                    continue;
                };
                if !matches!(
                    member.kind(),
                    "unnamedMemberParam" | "namedMemeberParam" | "namedMemberParam"
                ) {
                    continue;
                }
                let parameter = self.first_direct_kind(member, &["parameter", "namedParameter"]);
                let name = parameter
                    .and_then(|part| part.child_by_field_name("paraName"))
                    .map(|name| self.text(name).trim().to_string())
                    .unwrap_or_default();
                let visibility = self.visibility_of(member);
                self.create_node(
                    "field",
                    &name,
                    member,
                    Extra {
                        signature: Some(self.text(member).trim().chars().take(100).collect()),
                        visibility: Some(visibility),
                        is_exported: Some(visibility == 1),
                        ..Extra::default()
                    },
                );
            }
        }
        let visibility = self.visibility_of(node);
        let signature = self
            .first_direct_kind(node, &["primaryInitParamList"])
            .map(|parameters| self.text(parameters).chars().take(100).collect());
        let Some(row) = self.create_node(
            "method",
            "init",
            node,
            Extra {
                docstring: preceding_docstring(node, self.src),
                signature,
                visibility: Some(visibility),
                is_exported: Some(visibility == 1),
                ..Extra::default()
            },
        ) else {
            return;
        };
        self.stack.push(Scope {
            row,
            kind: "method",
            name: "init".to_string(),
        });
        self.walk_body(node);
        self.stack.pop();
    }

    fn extract_property(&mut self, node: Node<'t>) {
        let name = node
            .child_by_field_name("name")
            .or_else(|| self.first_direct_kind(node, &["propertyName"]))
            .map(|name| self.text(name).trim().to_string())
            .unwrap_or_default();
        let property_type = node
            .child_by_field_name("type")
            .map(|kind| format!(": {}", self.text(kind).trim()));
        let visibility = self.visibility_of(node);
        let modifiers = self.modifier_text(node);
        let decorators = if modifiers.split_whitespace().any(|part| part == "mut") {
            vec!["mut".to_string()]
        } else {
            Vec::new()
        };
        let extra = Extra {
            docstring: preceding_docstring(node, self.src),
            signature: property_type,
            visibility: Some(visibility),
            is_exported: Some(visibility == 1),
            is_static: Some(modifiers.split_whitespace().any(|part| part == "static")),
            decorators,
            ..Extra::default()
        };
        let Some(row) = self.create_node("property", &name, node, extra) else {
            return;
        };
        for field in ["getter", "setter"] {
            let mut cursor = node.walk();
            for accessor in node.children_by_field_name(field, &mut cursor) {
                if accessor.kind() == "block" {
                    self.stack.push(Scope {
                        row,
                        kind: "property",
                        name: name.clone(),
                    });
                    self.walk_body(accessor);
                    self.stack.pop();
                }
            }
        }
    }

    fn collect_binding_names(&self, node: Node<'t>, names: &mut Vec<String>) {
        if node.kind() == "varBindingPattern" {
            let name = self.text(node).trim();
            if !name.is_empty() && name != "_" {
                names.push(name.to_string());
            }
            return;
        }
        for i in 0..node.named_child_count() {
            if let Some(child) = node.named_child(i) {
                self.collect_binding_names(child, names);
            }
        }
    }

    fn extract_variable(&mut self, node: Node<'t>) {
        let name_node = node
            .child_by_field_name("name")
            .or_else(|| self.first_direct_kind(node, &["variableName"]));
        let Some(name_node) = name_node else {
            return;
        };
        let mut names = Vec::new();
        self.collect_binding_names(name_node, &mut names);
        if names.is_empty() {
            return;
        }
        let source = self.text(node);
        let immutable = source.trim_start().starts_with("let ")
            || source.trim_start().starts_with("const ")
            || source.contains(" let ")
            || source.contains(" const ");
        let is_static = self
            .modifier_text(node)
            .split_whitespace()
            .any(|part| part == "static");
        let kind = if self.inside_class_like() {
            if is_static && immutable {
                "constant"
            } else {
                "field"
            }
        } else if immutable {
            "constant"
        } else {
            "variable"
        };
        let declared_type = node
            .child_by_field_name("type")
            .map(|part| format!(": {}", self.text(part).trim()))
            .unwrap_or_default();
        let initializer = node.child_by_field_name("initilizer");
        let initializer_text = initializer
            .map(|part| self.text(part).trim().chars().take(80).collect::<String>())
            .unwrap_or_default();
        let signature = if declared_type.is_empty() && initializer_text.is_empty() {
            None
        } else if initializer_text.is_empty() {
            Some(declared_type)
        } else {
            Some(format!("{declared_type} = {initializer_text}"))
        };
        let visibility = self.visibility_of(node);
        let mut first_row = None;
        for name in names {
            let created = self.create_node(
                kind,
                &name,
                node,
                Extra {
                    docstring: preceding_docstring(node, self.src),
                    signature: signature.clone(),
                    visibility: Some(visibility),
                    is_exported: Some(visibility == 1),
                    is_static: Some(is_static),
                    ..Extra::default()
                },
            );
            if first_row.is_none() {
                first_row = created;
            }
        }
        if let (Some(initializer), Some(row)) = (initializer, first_row) {
            self.stack.push(Scope {
                row,
                kind,
                name: String::new(),
            });
            self.walk_body(initializer);
            self.stack.pop();
        }
    }

    fn collect_import_entries(&self, node: Node<'t>) -> Vec<ImportEntry> {
        let mut entries = Vec::new();
        let mut field_cursor = node.walk();
        for package in node.children_by_field_name("packageName", &mut field_cursor) {
            entries.push(ImportEntry {
                module: self.text(package).trim().to_string(),
                alias: None,
            });
        }
        for index in 0..node.named_child_count() {
            let Some(child) = node.named_child(index) else {
                continue;
            };
            match child.kind() {
                "packageFull" => {
                    if let Some(package) = child.child_by_field_name("packageName") {
                        entries.push(ImportEntry {
                            module: format!("{}.*", self.text(package).trim()),
                            alias: None,
                        });
                    }
                }
                "packageAlias" => {
                    if let Some(package) = child.child_by_field_name("packageName") {
                        entries.push(ImportEntry {
                            module: self.text(package).trim().to_string(),
                            alias: child
                                .child_by_field_name("alias")
                                .map(|alias| self.text(alias).trim().to_string()),
                        });
                    }
                }
                "packageGroup" => entries.extend(self.collect_import_entries(child)),
                "subGroupOfPackage" => {
                    let prefix = child
                        .child_by_field_name("packageName")
                        .map(|package| self.text(package).trim().to_string())
                        .unwrap_or_default();
                    if let Some(group) = self.first_direct_kind(child, &["packageGroup"]) {
                        for mut entry in self.collect_import_entries(group) {
                            if !prefix.is_empty() {
                                entry.module = format!("{prefix}.{}", entry.module);
                            }
                            entries.push(entry);
                        }
                    }
                }
                _ => {}
            }
        }
        entries
    }

    fn extract_imports(&mut self, node: Node<'t>) {
        let statement: String = self.text(node).trim().chars().take(120).collect();
        let is_public = statement.starts_with("public import");
        let entries = self.collect_import_entries(node);
        let mut seen = HashSet::new();
        for entry in entries {
            if entry.module.is_empty() || !seen.insert((entry.module.clone(), entry.alias.clone()))
            {
                continue;
            }
            let signature = entry
                .alias
                .as_ref()
                .map(|alias| format!("{statement} (as {alias})"))
                .or_else(|| Some(statement.clone()));
            self.create_node(
                "import",
                &entry.module,
                node,
                Extra {
                    signature,
                    visibility: Some(if is_public { 1 } else { 4 }),
                    is_exported: Some(is_public),
                    ..Extra::default()
                },
            );
            self.push_ref_at(
                self.top_row(),
                entry.module.trim_end_matches(".*"),
                "imports",
                node,
            );
        }
    }

    fn extract_inheritance(&mut self, node: Node<'t>, owner: u32) {
        let supers: Vec<Node> = (0..node.named_child_count())
            .filter_map(|i| node.named_child(i))
            .filter(|child| child.kind() == "superOrInterface")
            .collect();
        for (index, supertype) in supers.into_iter().enumerate() {
            let Some(target) = supertype.named_child(0) else {
                continue;
            };
            let name = self.text(target).trim().to_string();
            let kind = if node.kind() == "classDefinition" {
                if index == 0 {
                    "extends"
                } else {
                    "implements"
                }
            } else if node.kind() == "interfaceDefinition" {
                "extends"
            } else {
                "implements"
            };
            self.push_ref_at(owner, &name, kind, target);
        }
    }

    fn atomic_name(&self, node: Node) -> String {
        self.first_descendant_kind(node, &["varBindingPattern", "identifier"])
            .map(|binding| self.text(binding).trim().to_string())
            .unwrap_or_default()
    }

    fn call_argument_type(&self, argument: Node<'t>) -> Option<String> {
        let text = self.text(argument).trim();
        match argument.kind() {
            "integerLiteral" => {
                let lower = text.to_ascii_lowercase();
                for (suffix, type_name) in [
                    ("i8", "Int8"),
                    ("i16", "Int16"),
                    ("i32", "Int32"),
                    ("i64", "Int64"),
                    ("u8", "UInt8"),
                    ("u16", "UInt16"),
                    ("u32", "UInt32"),
                    ("u64", "UInt64"),
                ] {
                    if lower.ends_with(suffix) {
                        return Some(type_name.to_string());
                    }
                }
                Some("Int64".to_string())
            }
            "floatLiteral" => {
                let lower = text.to_ascii_lowercase();
                for (suffix, type_name) in [
                    ("f16", "Float16"),
                    ("f32", "Float32"),
                    ("f64", "Float64"),
                ] {
                    if lower.ends_with(suffix) {
                        return Some(type_name.to_string());
                    }
                }
                Some("Float64".to_string())
            }
            "stringLiteral" => Some("String".to_string()),
            "runeLiteral" => Some("Rune".to_string()),
            "byteLiteral" => Some("UInt8".to_string()),
            "booleanLiteral" => Some("Bool".to_string()),
            "unitLiteral" => Some("Unit".to_string()),
            "arrayLiteral" => Some("Array".to_string()),
            "lambdaExpression" | "trailingLambdaExpression" => Some("Function".to_string()),
            "atomicVariable" => {
                let name = self.atomic_name(argument);
                (!name.is_empty()).then(|| format!("$var:{name}"))
            }
            "parenthesizedExpression" | "unaryExpression" => argument
                .named_child(0)
                .and_then(|nested| self.call_argument_type(nested)),
            "postfixExpression" => {
                let first = argument.named_child(0)?;
                if first.kind() != "atomicVariable" {
                    return None;
                }
                let name = self.atomic_name(first);
                name.chars()
                    .next()
                    .is_some_and(char::is_uppercase)
                    .then_some(name)
            }
            _ => None,
        }
    }

    fn call_shape_hints(&self, node: Node<'t>) -> Vec<String> {
        let mut arguments: Vec<(Node<'t>, Option<String>)> = Vec::new();
        match node.kind() {
            "trailingLambdaExpression" => arguments.push((node, None)),
            "callSuffix" => {
                let mut index = 0;
                while index < node.named_child_count() {
                    let Some(child) = node.named_child(index) else {
                        index += 1;
                        continue;
                    };
                    let next = node.named_child(index + 1);
                    let named_label = if child.kind() == "varBindingPattern" {
                        next.filter(|next| {
                            self.src[child.end_byte()..next.start_byte()].trim() == ":"
                        })
                    } else {
                        None
                    };
                    if let Some(argument) = named_label {
                        arguments.push((
                            argument,
                            Some(self.text(child).trim().to_string()),
                        ));
                        index += 2;
                    } else {
                        arguments.push((child, None));
                        index += 1;
                    }
                }
                if let Some(trailing) = node
                    .parent()
                    .and_then(|parent| parent.next_named_sibling())
                    .filter(|next| next.kind() == "trailingLambdaExpression")
                {
                    arguments.push((trailing, None));
                }
            }
            "binaryExpression" => {
                if let Some(right) = node.child_by_field_name("right") {
                    arguments.push((right, None));
                }
            }
            "indexAccess" => {
                for index in 0..node.named_child_count() {
                    if let Some(argument) = node.named_child(index) {
                        arguments.push((argument, None));
                    }
                }
                if let Some(postfix) = node.parent() {
                    if let Some(assignment) = postfix
                        .parent()
                        .filter(|parent| parent.kind() == "assignmentExpression")
                    {
                        let is_assigned_variable = assignment
                            .child_by_field_name("variable")
                            .is_some_and(|variable| {
                                variable.start_byte() == postfix.start_byte()
                                    && variable.end_byte() == postfix.end_byte()
                            });
                        if is_assigned_variable {
                            if let Some(value) = assignment.child_by_field_name("value") {
                                arguments.push((value, Some("value".to_string())));
                            }
                        }
                    }
                }
            }
            "unaryExpression" => {}
            _ => return Vec::new(),
        }

        let mut hints = vec![format!("@cangjie/arity={}", arguments.len())];
        for (index, (argument, label)) in arguments.into_iter().enumerate() {
            if let Some(label) = label {
                hints.push(format!("@cangjie/label:{index}={label}"));
            }
            if let Some(type_name) = self.call_argument_type(argument) {
                hints.push(format!("@cangjie/type:{index}={type_name}"));
            }
        }
        hints
    }

    fn emit_method_call(
        &mut self,
        caller: u32,
        field: Node,
        at: Node,
        candidates: &[String],
    ) {
        let Some(member_atomic) = self.first_direct_kind(field, &["atomicVariable"]) else {
            return;
        };
        let method = self.atomic_name(member_atomic);
        if method.is_empty() {
            return;
        }
        let Some(receiver) = field.prev_named_sibling() else {
            return;
        };
        let name = match receiver.kind() {
            "atomicVariable" => {
                let receiver_name = self.atomic_name(receiver);
                if receiver_name.is_empty() {
                    method
                } else {
                    format!("{receiver_name}.{method}")
                }
            }
            "thisSuperExpression"
                if matches!(self.text(receiver).trim(), "this" | "super") =>
            {
                format!("{}.{method}", self.text(receiver).trim())
            }
            "postfixExpression" => {
                let mut receiver_text: String = self
                    .text(receiver)
                    .chars()
                    .filter(|character| !character.is_whitespace())
                    .collect();
                for _ in 0..4 {
                    receiver_text = collapse_call_arguments(&receiver_text);
                }
                if receiver_text.ends_with('?') {
                    receiver_text.pop();
                }
                // JavaScript's String.length counts UTF-16 code units. Match
                // that limit so CJK comments/identifiers in trailing-lambda
                // receivers do not make native reject an otherwise identical
                // call that the WASM path accepts.
                if receiver_text.is_empty() || receiver_text.encode_utf16().count() > 240 {
                    return;
                }
                format!("{receiver_text}.{method}")
            }
            _ => return,
        };
        self.push_ref_with_candidates(caller, &name, "calls", at, candidates);
    }

    fn extract_operator_call(&mut self, node: Node<'t>) {
        let receiver = match node.kind() {
            "binaryExpression" => node.child_by_field_name("left"),
            "unaryExpression" => node.child_by_field_name("argument"),
            "indexAccess" => node.prev_named_sibling(),
            _ => None,
        };
        let Some(receiver) = receiver else {
            return;
        };
        let receiver_name = match receiver.kind() {
            "atomicVariable" => self.atomic_name(receiver),
            "thisSuperExpression" if self.text(receiver).trim() == "this" => {
                "this".to_string()
            }
            "postfixExpression" => {
                let Some(first) = receiver.named_child(0) else {
                    return;
                };
                if first.kind() != "atomicVariable" {
                    return;
                }
                let name = self.atomic_name(first);
                if !name.chars().next().is_some_and(char::is_uppercase) {
                    return;
                }
                name
            }
            _ => return,
        };
        if receiver_name.is_empty() {
            return;
        }
        let operator = if node.kind() == "indexAccess" {
            "[]"
        } else {
            let Some(operator) = node.child_by_field_name("operator") else {
                return;
            };
            self.text(operator).trim()
        };
        if operator.is_empty() {
            return;
        }
        let candidates = self.call_shape_hints(node);
        self.push_ref_with_candidates(
            self.top_row(),
            &format!("{receiver_name}.operator{operator}"),
            "calls",
            node,
            &candidates,
        );
    }

    fn extract_call(&mut self, node: Node<'t>) {
        let caller = self.top_row();
        let Some(previous) = node.prev_named_sibling() else {
            return;
        };
        if node.kind() == "trailingLambdaExpression" && previous.kind() == "callSuffix" {
            return;
        }
        let candidates = self.call_shape_hints(node);
        match previous.kind() {
            "atomicVariable" => {
                let name = self.atomic_name(previous);
                if name.is_empty() {
                    return;
                }
                self.push_ref_with_candidates(
                    caller,
                    &name,
                    "calls",
                    node,
                    &candidates,
                );
            }
            "fieldAccess" => self.emit_method_call(caller, previous, node, &candidates),
            "thisSuperExpression"
                if matches!(self.text(previous).trim(), "this" | "super") =>
            {
                let name = format!("{}.init", self.text(previous).trim());
                self.push_ref_with_candidates(caller, &name, "calls", node, &candidates);
            }
            "postfixExpression" => {
                if let Some(last) =
                    previous.named_child(previous.named_child_count().saturating_sub(1))
                {
                    if last.kind() == "fieldAccess" {
                        self.emit_method_call(caller, last, node, &candidates);
                    }
                }
            }
            _ => {}
        }
    }

    fn extract_field_read(&mut self, node: Node<'t>) {
        let Some(parent) = node.parent() else {
            return;
        };
        if parent.kind() != "postfixExpression" {
            return;
        }
        if parent
            .next_named_sibling()
            .is_some_and(|next| matches!(next.kind(), "callSuffix" | "trailingLambdaExpression"))
        {
            return;
        }
        let Some(member_atomic) = self.first_direct_kind(node, &["atomicVariable"]) else {
            return;
        };
        let member = self.atomic_name(member_atomic);
        let Some(receiver) = node.prev_named_sibling() else {
            return;
        };
        let reference = if receiver.kind() == "atomicVariable" {
            let receiver_name = self.atomic_name(receiver);
            (!receiver_name.is_empty()).then(|| format!("{receiver_name}.{member}"))
        } else if receiver.kind() == "thisSuperExpression"
            && matches!(self.text(receiver).trim(), "this" | "super")
        {
            Some(format!("{}.{member}", self.text(receiver).trim()))
        } else if receiver.kind() == "postfixExpression" {
            let receiver_text: String = self
                .text(receiver)
                .chars()
                .filter(|character| !character.is_whitespace())
                .collect();
            let optional_receiver = receiver_text.strip_suffix('?').unwrap_or_default();
            is_cangjie_identifier(optional_receiver)
                .then(|| format!("{optional_receiver}.{member}"))
        } else {
            None
        };
        if let Some(reference) = reference {
            self.push_ref_at(self.top_row(), &reference, "references", node);
        }
    }
}

fn is_cangjie_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_alphabetic())
        && chars.all(|character| character == '_' || character.is_alphanumeric())
}

/// Replace flat parenthesized call arguments with `()` while retaining the
/// surrounding fluent-chain spelling.
fn collapse_call_arguments(input: &str) -> String {
    // Mirror JS `/\([^()]*\)/g`: replace only pairs that were innermost in
    // this pass. The caller repeats four passes, which intentionally retains
    // deeply nested argument spelling in exactly the same way as the WASM
    // extractor.
    let mut stack: Vec<(usize, bool)> = Vec::new();
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for (index, character) in input.char_indices() {
        match character {
            '(' => stack.push((index, false)),
            ')' => {
                let Some((start, has_nested_pair)) = stack.pop() else {
                    continue;
                };
                if !has_nested_pair {
                    ranges.push((start, index + character.len_utf8()));
                }
                if let Some((_, parent_has_nested_pair)) = stack.last_mut() {
                    *parent_has_nested_pair = true;
                }
            }
            _ => {}
        }
    }
    if ranges.is_empty() {
        return input.to_string();
    }
    ranges.sort_unstable_by_key(|range| range.0);
    let mut output = String::with_capacity(input.len());
    let mut cursor = 0;
    for (start, end) in ranges {
        output.push_str(&input[cursor..start]);
        output.push_str("()");
        cursor = end;
    }
    output.push_str(&input[cursor..]);
    output
}
