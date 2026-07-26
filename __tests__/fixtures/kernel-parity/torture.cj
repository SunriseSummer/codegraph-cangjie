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
}

public type TextBox = Box<String>

extend<T> Box<T> {
    public func mapped(): String {
        return value.toString()
    }
}

func build(): Box<String> {
    let box = Box<String>("ready")
    box.render()
    box.label
    return box
}

func inspectOptional(box: ?Box<String>): Unit {
    box?.render()
    box?.label
}
