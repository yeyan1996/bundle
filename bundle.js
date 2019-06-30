const parser = require("@babel/parser")
const fs = require("fs")
const path = require("path")
const traverse = require("@babel/traverse").default //提取AST中的特定字段
const core = require("@babel/core")

//bundlePath即分析的ES6模块路径（相对于bundle.js的相对路径）
const moduleAnalyser = function (bundlePath) {
    let code = fs.readFileSync(bundlePath, "utf-8")
    //将代码转换为AST
    let ast = parser.parse(code, {
        sourceType: "module" //表示对ES6 module的代码分析
    })

    const dependencies = {}
    // 通过 traverse 可以遍历整个 AST 树，并且当遍历到特定的 AST 时会触发钩子回调
    // 钩子包含 enter 和 exit 2种，当刚刚进入时会触发 enter，当回溯时会触发 exit 钩子（因为是树形结构）
    traverse(ast, {
        ImportDeclaration({node}) {
            //定义一个依赖关系的对象，属性是相对与模块的路径，值是相对于bundle.js的路径
            dependencies[node.source.value] = "./" + path.join("./src/", node.source.value).split(path.sep).join("/")
        }
    })

    //将ast转为ES5的code
    const {code: transformedCode} = core.transformFromAstSync(ast, null, {
        presets: ["@babel/preset-env"]
    })

    return {
        bundlePath,
        dependencies,
        transformedCode
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
    //graph是个对象，属性表示模块相对于bundle.js的路径，值是模块的信息（模块的依赖和模块的code）
    let graph = makeDependenciesGraph(entry)
    console.log(graph)
    return `
         //IIFE
      (function (graph) {
         //定义require函数，因为浏览器中没有require函数
         function require(bundlePath) {
                 // 定义localRequire
                 // 因为模块内部的require使用的是相对与当前模块的路径,必须修改为相对于bundle.js的路径否则会找不到    
                 function localRequire(modulePath) {
                    return require(graph[bundlePath].dependencies[modulePath])
                 }

                   var exports = {};

                   //防止模块内部的变量影响到外部，所以也需要设置一个IIFE
                   (function (require, transformedCode) {
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

