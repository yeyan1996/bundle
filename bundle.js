const parser = require("@babel/parser")
const fs = require("fs")
const path = require("path")
const traverse = require("@babel/traverse").default //提取AST中的特定字段
const core = require("@babel/core")

// bundlePath即分析的 ES6 模块路径（相对于 bundle.js 的相对路径）
const moduleAnalyser = function (bundlePath) {
    let code = fs.readFileSync(bundlePath, "utf-8")
    // 将代码转换为 AST
    let ast = parser.parse(code, {
        sourceType: "module" //表示对ES6 module的代码分析
    })

    const dependencies = {}
    traverse(ast, {
        ImportDeclaration({node}) {
            // 通过分析 AST 生成一个依赖关系(dependencies)的对象，属性是相对与模块的路径，值是相对于bundle.js的路径
            // 针对 windows 平台做了一些路径的格式化，mac 可能会出错
            dependencies[node.source.value] = "./" + path.join("./src/", node.source.value).split(path.sep).join("/")
        }
    })

    // 将 ast 转为 commonjs 规范的 ES5 的 code
    const {code: transformedCode} = core.transformFromAstSync(ast, null, {
        presets: ["@babel/preset-env"]
    })

    return {
        bundlePath, // 模块相对于 bundle.js 的路径
        dependencies, // 模块的依赖项对象
        transformedCode // 模块的 code
    }
}

const makeDependenciesGraph = function (entry) {
    let dependenciesArray = [moduleAnalyser(entry)]
    let graph = {}

    for (let i = 0; i < dependenciesArray.length; i++) {
        if (dependenciesArray[i].dependencies) {
            Object.keys(dependenciesArray[i].dependencies).forEach(modulePath => {
                dependenciesArray.push(
                    moduleAnalyser(dependenciesArray[i].dependencies[modulePath])
                )
            })
        }
    }
    dependenciesArray.forEach(item => {
        graph[item.bundlePath] = {
            dependencies: item.dependencies,
            transformedCode: item.transformedCode
        }
    })
    return graph
}


const generateCode = (entry) => {
    // graph 是个对象，属性表示模块相对于bundle.js的路径，值是模块的信息（模块的依赖和模块的code）
    let graph = makeDependenciesGraph(entry)
    console.log(graph)
    return `
         //IIFE
      (function (graph) {
         // 自定义 require 函数，用来模拟浏览器无法实现的 commonjs 规范
         // 参数为相对于 bundle.js 的路径
         // 因为这样可以直接在 graph 中根据路径找到对应的模块信息
         function require(bundlePath) {
                 // 因为模块内部的 require 使用的是相对与当前模块的路径
                 // 所以需要一个函数将相对于当前执行文件的路径，转换为相对于 bundle.js 的路径    
                 function localRequire(modulePath) {
                    return require(graph[bundlePath].dependencies[modulePath])
                 }
                   
                   // 每个模块定义一个 exports 对象用来存放导出的变量
                   // 当另外一个模块需要加载当前模块时，会先到 graph 中找到对应模块加载代码
                   // 并且在执行代码时，当这个模块需要导出变量时，会在 exports 对象上添加导出的变量
                   // 当另一个模块需要加载当前模块时，最终会得到当前模块的 exports 对象
                   var exports = {};

                   //防止模块内部的变量影响到外部，所以也需要设置一个IIFE
                   (function (require, transformedCode) {
                   // 当代码中需要加载模块时会执行 require(relativePath) 
                   // 此时需要传入一个 require 函数，并且能够让 relativePath 变成相对于 bundle.js 的路径
                   // 所以需要让 require 函数执行 localRequire，进行一层转换 
                       eval(transformedCode)
                 })(localRequire, graph[bundlePath].transformedCode);
    
                   return exports
              }

                require("${entry}")
            })(${JSON.stringify(graph)}) //传入graph对象
    `
}

let code = generateCode('./src/main.js')

eval(code)

