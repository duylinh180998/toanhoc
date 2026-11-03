/**
 * Phân tích & biên dịch biểu thức f(x) bằng math.js (nạp từ CDN, biến toàn cục `math`).
 *
 * An toàn:
 *  - Chỉ cho phép một tập nút AST nhỏ (số, x, toán tử, hàm toán học, ?:) ⇒ không thể gán biến,
 *    truy cập thuộc tính, tạo ma trận/đối tượng...
 *  - Mọi lần tính đều bọc try/catch; kết quả không phải số thực hữu hạn (chia 0, số phức như
 *    sqrt(-1), log(-1)...) đều trả về NaN để bộ truy vết dừng tia một cách êm ái.
 */

const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'asin', 'acos', 'atan', 'acot', 'asec', 'acsc', 'atan2',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'sqrt', 'cbrt', 'nthRoot', 'abs', 'sign', 'exp', 'log', 'log10', 'log2',
  'pow', 'floor', 'ceil', 'round', 'fix', 'mod', 'min', 'max', 'hypot',
]);
const CONSTANTS = new Set(['pi', 'PI', 'e', 'E', 'tau', 'phi']);
const ALLOWED_NODES = new Set([
  'ConstantNode', 'SymbolNode', 'OperatorNode', 'FunctionNode',
  'ParenthesisNode', 'ConditionalNode', 'RelationalNode',
]);

/** Thông báo lỗi tiếng Việt cho các lỗi cú pháp thường gặp của math.js. */
const ERROR_TRANSLATIONS = [
  [/Parenthesis \) expected/i, 'Thiếu dấu ngoặc đóng “)”'],
  [/Unexpected end of expression/i, 'Biểu thức chưa hoàn chỉnh'],
  [/Value expected/i, 'Thiếu số hoặc biến sau toán tử'],
  [/Unexpected operator/i, 'Toán tử đặt sai vị trí'],
  [/Unexpected type of argument|Too many arguments|Too few arguments/i, 'Sai số lượng/loại đối số của hàm'],
  [/Syntax error/i, 'Lỗi cú pháp'],
];

/** Chuẩn hoá cách gõ "tự nhiên" về cú pháp math.js. */
export function normalizeFormula(src) {
  return String(src ?? '')
    .replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=/i, '') // bỏ tiền tố "y =" / "f(x) ="
    .replace(/[−–—]/g, '-')
    .replace(/[×·⋅∙]/g, '*')
    .replace(/÷/g, '/')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/π/g, 'pi')
    .replace(/√\s*\(/g, 'sqrt(')
    .replace(/√\s*([a-z0-9.]+)/gi, 'sqrt($1)')
    .replace(/\bln\s*\(/g, 'log(')
    .replace(/\bX\b/g, 'x')
    .trim();
}

function translateError(message, text) {
  const pos = /\(char (\d+)\)/.exec(message);
  const where = pos ? ` (vị trí ${pos[1]})` : '';
  for (const [re, vi] of ERROR_TRANSLATIONS) if (re.test(message)) return vi + where;
  if (/\d,\d/.test(text)) return 'Dùng dấu chấm cho số thập phân (0.05 thay vì 0,05)';
  return message;
}

/** Kiểm tra AST theo whitelist. Trả về chuỗi lỗi hoặc null. */
function validateTree(root) {
  let error = null;
  root.traverse((node, path, parent) => {
    if (error) return;
    if (!ALLOWED_NODES.has(node.type)) {
      error = `Cú pháp “${node.toString()}” không được hỗ trợ`;
      return;
    }
    if (node.type === 'ConstantNode' && typeof node.value !== 'number' && typeof node.value !== 'boolean') {
      error = 'Chỉ dùng số thực trong biểu thức';
    } else if (node.type === 'FunctionNode' && node.fn.type !== 'SymbolNode') {
      error = 'Lời gọi hàm không hợp lệ';
    } else if (node.type === 'SymbolNode') {
      const isCallee = parent?.type === 'FunctionNode' && path === 'fn';
      if (isCallee) {
        if (!FUNCTIONS.has(node.name)) error = `Hàm “${node.name}” không được hỗ trợ`;
      } else if (node.name !== 'x' && !CONSTANTS.has(node.name)) {
        error = FUNCTIONS.has(node.name)
          ? `Hàm “${node.name}” cần dấu ngoặc, ví dụ ${node.name}(x)`
          : `Ký hiệu “${node.name}” không hợp lệ — chỉ dùng biến x`;
      }
    }
  });
  return error;
}

/**
 * Biên dịch công thức. Kết quả:
 *  { ok: true, fn(x) → number|NaN, text } hoặc { ok: false, error }
 */
export function compileFormula(src) {
  const math = globalThis.math;
  if (!math) return { ok: false, error: 'Chưa tải được thư viện math.js' };

  const text = normalizeFormula(src);
  if (!text) return { ok: false, error: 'Hãy nhập một hàm số, ví dụ: 0.5*x', empty: true };

  let tree;
  try {
    tree = math.parse(text);
  } catch (err) {
    return { ok: false, error: translateError(err.message, text) };
  }
  const invalid = validateTree(tree);
  if (invalid) return { ok: false, error: invalid };

  let code;
  try {
    code = tree.compile();
  } catch (err) {
    return { ok: false, error: translateError(err.message, text) };
  }

  // Dùng Map làm scope: math.js không phải bọc object mỗi lần gọi ⇒ nhanh hơn đáng kể.
  const scope = new Map([['x', 0]]);
  const fn = (x) => {
    scope.set('x', x);
    let y;
    try {
      y = code.evaluate(scope);
    } catch {
      return NaN;
    }
    if (typeof y === 'number') return Number.isFinite(y) ? y : NaN; // 1/0 = Infinity ⇒ NaN
    if (typeof y === 'boolean') return y ? 1 : 0;
    return NaN; // Complex, Matrix, Unit... ⇒ ngoài miền số thực
  };

  return { ok: true, fn, text };
}

/**
 * Điểm "neo" cho công thức Y(x) = y0 + f(x − x0) − f(0).
 * Bình thường neo tại t = 0 (giá trị f(0)). Nếu f(0) không xác định (log(x), 1/x...), neo tại
 * điểm xác định đầu tiên cách nhân vật 1px, 2px, 5px, 10px theo hướng bắn — xấp xỉ giới hạn một
 * phía — và đồ thị bắt đầu từ đó.
 * @returns {{ offset: number, value: number } | null}  offset tính bằng đơn vị toán (≥ 0)
 */
export function anchorPoint(fn, dir) {
  for (const t of [0, 0.05, 0.1, 0.25, 0.5]) {
    const value = fn(dir * t);
    if (Number.isFinite(value)) return { offset: t, value };
  }
  return null;
}
