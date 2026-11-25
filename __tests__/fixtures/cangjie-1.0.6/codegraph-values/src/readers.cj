package engineering
public func readGlobal(): Int64 { LIMIT }
public func readFunction(): (Int64) -> Int64 { handler }
public func parameterShadow(LIMIT: Int64): Int64 { LIMIT }
public func localShadow(): Int64 { let LIMIT = 4; LIMIT }
public func loopShadow(): Unit { for (LIMIT in [1, 2]) { println(LIMIT) } }
public func lambdaShadow(): Int64 { let f = { LIMIT: Int64 => LIMIT }; f(4) }
public func matchShadow(value: ?Int64): Int64 {
    match(value) { case Some(LIMIT) => LIMIT; case None => 0 }
}
public func blockShadow(): Int64 {
    if (true) { let LIMIT = 3; println(LIMIT) }
    LIMIT
}
public func captureGlobal(): Int64 { let f = { => LIMIT }; f() }
public func parameterCallback(handler: (Int64) -> Int64): Int64 { handler(1) }
public func localCallback(): Int64 { let handler = { n: Int64 => n + 1 }; handler(1) }
