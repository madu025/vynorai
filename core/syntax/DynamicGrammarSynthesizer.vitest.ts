import { describe, it, expect } from "vitest";
import { DynamicGrammarSynthesizer } from "./DynamicGrammarSynthesizer";
import { getSymbolsForFile } from "../util/treeSitter";

describe("VynorAI Dynamic Grammar & Language Synthesis", () => {
  describe("Next-Gen Language Parsing: Mojo (.mojo)", () => {
    it("extracts functions, structs, and aliases from Mojo code", () => {
      const mojoCode = `
# Mojo Tensor math module
alias FloatDType = DType.float32

struct TensorMatrix:
    var rows: Int
    var cols: Int

fn matmul(a: TensorMatrix, b: TensorMatrix) -> TensorMatrix:
    return TensorMatrix(a.rows, b.cols)

def test_inference():
    print("Testing inference...")
`;

      const symbols = DynamicGrammarSynthesizer.extractSymbols(
        "mojo",
        mojoCode,
      );
      expect(symbols.length).toBe(4);

      const names = symbols.map((s) => s.name);
      expect(names).toContain("FloatDType");
      expect(names).toContain("TensorMatrix");
      expect(names).toContain("matmul");
      expect(names).toContain("test_inference");

      const structSym = symbols.find((s) => s.name === "TensorMatrix");
      expect(structSym?.type).toBe("struct");

      const fnSym = symbols.find((s) => s.name === "matmul");
      expect(fnSym?.type).toBe("function");
    });
  });

  describe("Next-Gen Language Parsing: Zig (.zig)", () => {
    it("extracts public functions and struct definitions from Zig code", () => {
      const zigCode = `
const std = @import("std");

pub const ServerConfig = struct {
    port: u16,
    host: []const u8,
};

pub fn startServer(config: ServerConfig) !void {
    std.debug.print("Listening on {d}", .{config.port});
}

fn handleConnection() void {
    // internal handler
}
`;

      const symbols = DynamicGrammarSynthesizer.extractSymbols("zig", zigCode);
      expect(symbols.length).toBe(3);

      const names = symbols.map((s) => s.name);
      expect(names).toContain("ServerConfig");
      expect(names).toContain("startServer");
      expect(names).toContain("handleConnection");
    });
  });

  describe("Next-Gen Language Parsing: Carbon (.carbon)", () => {
    it("extracts classes and functions from Carbon code", () => {
      const carbonCode = `
package Geometry api;

class Vector3 {
  var x: f32;
  var y: f32;
  var z: f32;
}

fn Normalize(v: Vector3) -> Vector3 {
  return v;
}
`;

      const symbols = DynamicGrammarSynthesizer.extractSymbols(
        "carbon",
        carbonCode,
      );
      expect(symbols.length).toBe(2);
      expect(symbols[0].name).toBe("Vector3");
      expect(symbols[0].type).toBe("class");
      expect(symbols[1].name).toBe("Normalize");
      expect(symbols[1].type).toBe("function");
    });
  });

  describe("Next-Gen Language Parsing: Cairo (.cairo)", () => {
    it("extracts Starknet smart contract functions and structs", () => {
      const cairoCode = `
pub struct AccountBalance {
    amount: u256,
}

pub fn transfer_balance(recipient: ContractAddress, amount: u256) -> bool {
    return true;
}
`;
      const symbols = DynamicGrammarSynthesizer.extractSymbols(
        "cairo",
        cairoCode,
      );
      expect(symbols.length).toBe(2);
      expect(symbols[0].name).toBe("AccountBalance");
      expect(symbols[0].type).toBe("struct");
      expect(symbols[1].name).toBe("transfer_balance");
      expect(symbols[1].type).toBe("function");
    });
  });

  describe("Next-Gen Language Parsing: Move (.move)", () => {
    it("extracts modules, entry functions, and structs", () => {
      const moveCode = `
module 0x1::liquidity_pool {
    struct Pool has key {
        balance_x: u64,
        balance_y: u64,
    }

    public entry fun swap_tokens(sender: &signer, amount_in: u64) {
        // swap logic
    }
}
`;
      const symbols = DynamicGrammarSynthesizer.extractSymbols(
        "move",
        moveCode,
      );
      expect(symbols.length).toBe(3);
      expect(symbols[0].name).toBe("0x1::liquidity_pool");
      expect(symbols[0].type).toBe("module");
      expect(symbols[1].name).toBe("Pool");
      expect(symbols[1].type).toBe("struct");
      expect(symbols[2].name).toBe("swap_tokens");
      expect(symbols[2].type).toBe("function");
    });
  });

  describe("Next-Gen Language Parsing: Gleam (.gleam)", () => {
    it("extracts public functions and custom types", () => {
      const gleamCode = `
pub type HttpResponse {
    Ok(body: String)
    NotFound
}

pub fn render_page(title: String) -> HttpResponse {
    Ok("Hello")
}
`;
      const symbols = DynamicGrammarSynthesizer.extractSymbols(
        "gleam",
        gleamCode,
      );
      expect(symbols.length).toBe(2);
      expect(symbols[0].name).toBe("HttpResponse");
      expect(symbols[0].type).toBe("type");
      expect(symbols[1].name).toBe("render_page");
      expect(symbols[1].type).toBe("function");
    });
  });

  describe("Next-Gen Language Parsing: Mojo with emoji extension (.🔥)", () => {
    it("extracts symbols from .🔥 extension files", () => {
      const mojoFireCode = `
struct NeuralTensor:
    var dim: Int

fn forward_pass(x: NeuralTensor) -> NeuralTensor:
    return x
`;
      const symbols = DynamicGrammarSynthesizer.extractSymbols(
        "🔥",
        mojoFireCode,
      );
      expect(symbols.length).toBe(2);
      expect(symbols[0].name).toBe("NeuralTensor");
      expect(symbols[1].name).toBe("forward_pass");
    });
  });

  describe("Custom Dynamic Grammar Registration", () => {
    it("allows registering and parsing custom future languages at runtime", () => {
      DynamicGrammarSynthesizer.registerSpecification({
        name: "futurelang",
        extensions: ["future2035"],
        family: "functional",
        commentTokens: { line: ["--"] },
        keywords: ["agent", "action"],
        symbolPatterns: {
          functions: [/^\s*action\s+([A-Za-z0-9_]+)\s*\(/gm],
          classes: [/^\s*agent\s+([A-Za-z0-9_]+)/gm],
        },
      });

      const futureCode = `
-- Future 2035 code
agent AutonomousSwarmWorker {
    priority: 1
}

action dispatchTask(id: String) {
    -- execute
}
`;
      const symbols = DynamicGrammarSynthesizer.extractSymbols(
        "future2035",
        futureCode,
      );
      expect(symbols.length).toBe(2);
      expect(symbols[0].name).toBe("AutonomousSwarmWorker");
      expect(symbols[0].type).toBe("class");
      expect(symbols[1].name).toBe("dispatchTask");
      expect(symbols[1].type).toBe("function");
    });
  });

  describe("Zero-Shot Unknown Language Heuristic Synthesis", () => {
    it("dynamically infers specification and extracts symbols for an unknown extension", () => {
      const customDslCode = `
// Custom Quantum DSL
class QuantumCircuit {
  var qubits = 5
}

function ApplyHadamard(target: Int) {
  // apply gate
}

proc MeasureAll() {
  // measurement
}
`;

      const symbols = DynamicGrammarSynthesizer.extractSymbols(
        "qdsl",
        customDslCode,
      );
      expect(symbols.length).toBe(3);

      const names = symbols.map((s) => s.name);
      expect(names).toContain("QuantumCircuit");
      expect(names).toContain("ApplyHadamard");
      expect(names).toContain("MeasureAll");
    });
  });

  describe("Integration with getSymbolsForFile", () => {
    it("seamlessly extracts symbols for .mojo files through the treeSitter pipeline", async () => {
      const mojoCode = `
fn calculateSum(x: Int, y: Int) -> Int:
    return x + y
`;

      const symbols = await getSymbolsForFile("math.mojo", mojoCode);
      expect(symbols).toBeDefined();
      expect(symbols!.length).toBe(1);
      expect(symbols![0].name).toBe("calculateSum");
      expect(symbols![0].filepath).toBe("math.mojo");
    });

    it("seamlessly extracts symbols for .zig, .carbon, .cairo, and zero-shot files", async () => {
      const zigSymbols = await getSymbolsForFile(
        "server.zig",
        "pub fn listen(port: u16) void {}",
      );
      expect(zigSymbols).toBeDefined();
      expect(zigSymbols![0].name).toBe("listen");

      const cairoSymbols = await getSymbolsForFile(
        "contract.cairo",
        "pub fn mint_token() -> bool { return true; }",
      );
      expect(cairoSymbols).toBeDefined();
      expect(cairoSymbols![0].name).toBe("mint_token");

      const unknownSymbols = await getSymbolsForFile(
        "neural.unknown",
        "class DeepNetwork {}\nfunc trainModel() {}",
      );
      expect(unknownSymbols).toBeDefined();
      expect(unknownSymbols!.length).toBe(2);
    });
  });
});
