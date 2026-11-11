import { outlineOf } from './symbol-outline';

const typescript = [
  "import { Injectable } from '@angular/core';", // 1
  '', // 2
  "@Injectable({ providedIn: 'root' })", // 3
  'export class HandshakeService {', // 4
  "  readonly state = 'idle';", // 5
  '', // 6
  '  connect(attempt: number): boolean {', // 7
  '    return attempt < 5;', // 8
  '  }', // 9
  '', // 10
  '  private readonly retry = () => {', // 11
  '    const later = function () {', // 12
  '      return 1;', // 13
  '    };', // 14
  '  };', // 15
  '}', // 16
  '', // 17
  'export interface Port {', // 18
  '  send(message: string): void;', // 19
  '}', // 20
  '', // 21
  'export function top() {', // 22
  '  class Inner {', // 23
  '    run() {', // 24
  '      return [1].map(() => 2);', // 25
  '    }', // 26
  '  }', // 27
  '}', // 28
  'const handlers = { open() {}, close: () => 0 };', // 29
  'namespace Wire {', // 30
  '  export enum Kind { A }', // 31
  '}', // 32
  '',
].join('\n');

const java = [
  'package app;', // 1
  '', // 2
  'public class Server {', // 3
  '  private int port;', // 4
  '', // 5
  '  public Server(int port) {', // 6
  '    this.port = port;', // 7
  '  }', // 8
  '', // 9
  '  void start() {', // 10
  '    run();', // 11
  '  }', // 12
  '', // 13
  '  record Address(String host) {', // 14
  '    Address {', // 15
  '      host.trim();', // 16
  '    }', // 17
  '    String url() { return host; }', // 18
  '  }', // 19
  '', // 20
  '  enum State {', // 21
  '    IDLE;', // 22
  '    boolean live() { return false; }', // 23
  '  }', // 24
  '', // 25
  '  interface Listener {', // 26
  '    default void heard() {}', // 27
  '  }', // 28
  '}', // 29
  '', // 30
  '@interface Marker {', // 31
  '  int value();', // 32
  '}', // 33
  '',
].join('\r\n');

describe('The symbols of a Breadcrumb', () => {
  it('give the chain of TypeScript declarations that holds a line, nested ones included', async () => {
    const outline = await outlineOf(typescript, 'typescript');
    expect(outline(1)).toEqual([]);
    expect(outline(4)).toEqual(['HandshakeService']);
    expect(outline(5)).toEqual(['HandshakeService']);
    expect(outline(8)).toEqual(['HandshakeService', 'connect()']);
    expect(outline(13)).toEqual(['HandshakeService', 'retry()', 'later()']);
    expect(outline(19)).toEqual(['Port', 'send()']);
    expect(outline(25)).toEqual(['top()', 'Inner', 'run()']);
    expect(outline(29)).toEqual([]);
    expect(outline(31)).toEqual(['Wire', 'Kind']);
  });

  it('name the methods of an object by their property', async () => {
    const outline = await outlineOf('const handlers = {\n  open() {\n    go();\n  },\n  close: () => {\n    stop();\n  },\n};\n', 'javascript');
    expect(outline(3)).toEqual(['open()']);
    expect(outline(6)).toEqual(['close()']);
  });

  it('read TSX and JSX', async () => {
    const tsx = 'export function App(): JSX.Element {\n  return <div>{1}</div>;\n}\n';
    expect((await outlineOf(tsx, 'tsx'))(2)).toEqual(['App()']);
    const jsx = 'export function App() {\n  return <div>{1}</div>;\n}\n';
    expect((await outlineOf(jsx, 'jsx'))(2)).toEqual(['App()']);
  });

  it('give the chain of Java declarations: types, methods, constructors and compact constructors, nested ones included', async () => {
    const outline = await outlineOf(java, 'java');
    expect(outline(1)).toEqual([]);
    expect(outline(4)).toEqual(['Server']);
    expect(outline(7)).toEqual(['Server', 'Server()']);
    expect(outline(11)).toEqual(['Server', 'start()']);
    expect(outline(16)).toEqual(['Server', 'Address', 'Address()']);
    expect(outline(18)).toEqual(['Server', 'Address', 'url()']);
    expect(outline(23)).toEqual(['Server', 'State', 'live()']);
    expect(outline(27)).toEqual(['Server', 'Listener', 'heard()']);
    expect(outline(32)).toEqual(['Marker']);
  });

  it('give a blank line the declarations around it, and a line past the end none', async () => {
    const outline = await outlineOf(typescript, 'typescript');
    expect(outline(6)).toEqual(['HandshakeService']);
    expect(outline(999)).toEqual([]);
  });
});
