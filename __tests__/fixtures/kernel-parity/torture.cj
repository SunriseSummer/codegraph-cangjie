package demo.graph

import std.collection.*

public interface Renderable {
    func render(): Unit
}

open class Base {
    public init() {}
}

public class Box<T> <: Base & Renderable where T <: ToString {
    public Box(public let value: T) {}

    public mut prop label: String {
        get() { return value.toString() }
        set(next) { println(next) }
    }

    public func render(): Unit {
        println(label)
        this.helper()
    }

    private func helper(): Unit {
        println(value)
    }
}

public enum Outcome<T> {
    Ok(T) | Err(String)

    public func inspect(): Unit {}
}

public type TextBox = Box<String>

extend<T> Box<T> {
    public func mapped(): String {
        return value.toString()
    }
}

public class Selector {
    public init() {}

    public func select(value: Int64): Unit {}
    public func select(value: String): Unit {}

    public operator func +(other: Int64): Selector { this }
    public operator func +(other: String): Selector { this }
    public operator func [](index: Int64): String { "value" }
    public operator func [](index: Int64, value!: String): Unit {}
    public operator func -(): Selector { this }
    public operator func ()(scale: Int64): Selector { this }
}

class lowercase {
    public init() {}
}

func Uppercase(): Unit {}

func format(value: Int64, radix!: Int64 = 10): String { value.toString() }
func format(value: String): String { value }

func route(condition: Bool, body: () -> Int64): Int64 { body() }
func route(condition: String, body: () -> Int64): Int64 { body() }

func collect(value: Int64): Int64 { value }
func collect(values: Array<Int64>): Int64 { values.size }
func consume(outcome: Outcome<String>): Unit {}

func build(): Box<String> {
    let box = Box<String>("ready")
    box.render()
    box.label
    let selector = Selector()
    selector.select(1)
    selector.select("ready")
    let byNumber = selector + 1
    let byText = selector + "ready"
    let indexed = selector[0]
    selector[0] = "updated"
    let negated = -selector
    let invoked = selector(2)
    let lower = lowercase()
    Uppercase()
    format(1)
    format(1, radix: 16)
    format("ready")
    route(true) { 1 }
    collect(1)
    collect(1, 2, 3)
    consume(Ok<String>("ready"))
    Ok<String>("ready").inspect()
    return box
}

func inspectOptional(box: ?Box<String>): Unit {
    box?.render()
    box?.label
}
