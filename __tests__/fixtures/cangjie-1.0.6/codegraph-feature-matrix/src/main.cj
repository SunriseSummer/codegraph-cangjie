package codegraph_feature_matrix

public interface Describable {
    func describe(): String
}

public class Box<T> <: Describable where T <: ToString {
    public let value: T
    public init(value: T) { this.value = value }
    public prop label: String { get() { value.toString() } }
    public func describe(): String { label }
}

extend<T> Box<T> where T <: ToString {
    public func sizeHint(): Int64 { 1 }
}

public struct Point {
    public let x: Int64
    public init(x: Int64) { this.x = x }
    public operator func +(other: Point): Point { Point(x + other.x) }
}

public enum Outcome {
    Success(Int64) | Failure(String)
}

public func render(value: Int64): String { value.toString() }
public func render(value: String): String { value }
public func apply(body: () -> Int64): Int64 { body() }
public func 中文标识(): Int64 { 6 }
public func inspectOptional(box: ?Box<String>): Unit {
    box?.describe()
    box?.label
}

main(): Int64 {
    let box = Box<String>("ready")
    render(1)
    render("ready")
    box.sizeHint()
    box.describe()
    let point = Point(2) + Point(3)
    let ok = Success(point.x)
    let bad = Failure("probe")
    inspectOptional(Some(box))
    let result = apply { 7 } + 中文标识()
    println("feature-matrix: ${result}")
    return 0
}
