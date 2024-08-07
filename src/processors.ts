import { MarkdownPostProcessorContext } from 'obsidian';
import * as tmp from 'tmp';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import GraphvizPlugin from './main';
// import {graphviz} from 'd3-graphviz'; => does not work, ideas how to embed d3 into the plugin?

export class Processors {
  plugin: GraphvizPlugin;

  constructor(plugin: GraphvizPlugin) {
    this.plugin = plugin;
  }

  imageMimeType = new Map<string, string>([
    ['png', 'image/png'],
    ['svg', 'image/svg+xml']
  ]);

  private async writeDotFile(sourceFile: string): Promise<Uint8Array> {
    const LIKELY_LOCATIONS = '/usr/local/bin:/opt/homebrew/bin:/snap/bin:/bin:/usr/bin';

    return new Promise<Uint8Array>((resolve, reject) => {
      const cmdPath = this.plugin.settings.dotPath.trim();
      const imageFormat = this.plugin.settings.imageFormat;
      const alreadyQualified = (cmdPath.contains('/') || cmdPath.contains('\\'));
      const isWin = process.platform === 'win32';
      const execPrefix = (alreadyQualified || isWin) ? [] : ['/usr/bin/env', '-P', LIKELY_LOCATIONS];
      const execFull = execPrefix.concat([cmdPath, `-T${imageFormat}`, sourceFile]);

      console.debug(`Starting dot process [${execFull}]`);
      const dotProcess = spawn(execFull[0], execFull.slice(1));
      const outData: Array<Uint8Array> = [];
      let errData = '';

      dotProcess.stdout.on('data', function (data) {
        outData.push(data);
      });
      dotProcess.stderr.on('data', function (data) {
        errData += data;
      });
      dotProcess.stdin.end();
      dotProcess.on('exit', function (code) {
        if (code == 0) {
          resolve(Buffer.concat(outData));
        } else if (code == 127) {
          reject(`spawn [${execFull}] failed, stderr: ${errData}. Check the dot file path is correct.`);
        } else {
          reject(`exit code: ${code}, stderr: ${errData}`);
        }
      });
      dotProcess.on('error', function (err: Error) {
        reject(`spawn [${execFull}] failed, ${err}`);
      });
    });
  }

  private async convertToImage(source: string): Promise<Uint8Array> {
    const self = this;
    return new Promise<Uint8Array>((resolve, reject) => {
      tmp.file(function (err, tmpPath, fd, _/* cleanupCallback */) {
        if (err) reject(err);

        fs.write(fd, source, function (err) {
          if (err) {
            reject(`write to ${tmpPath} error ${err}`);
            return;
          }
          fs.close(fd,
            function (err) {
              if (err) {
                reject(`close ${tmpPath} error ${err}`);
                return;
              }
              return self.writeDotFile(tmpPath).then(data => resolve(data)).catch(message => reject(message));
            }
          );
        });
      });
    });
  }

  public async imageProcessor(source: string, el: HTMLElement, _: MarkdownPostProcessorContext): Promise<void> {
    try {
      console.debug('Call image processor');
      //make sure url is defined. once the setting gets reset to default, an empty string will be returned by settings
      const imageData = await this.convertToImage(source);
      const imageMimeType = this.imageMimeType.get(this.plugin.settings.imageFormat);
      const blob = new Blob([imageData], { 'type': imageMimeType });
      const url = window.URL || window.webkitURL;
      const blobUrl = url.createObjectURL(blob);
      const img = document.createElement('img');
      const obj = document.createElement('object');

      img.src = blobUrl;
      obj.appendChild(img);
      obj.type = imageMimeType;
      obj.data = blobUrl;
      obj.addClass('graphviz-image');
      el.appendChild(obj);
    } catch (errMessage) {
      console.error('convert to image error', errMessage);
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      pre.appendChild(code);
      code.setText(errMessage);
      el.appendChild(pre);
    }
  }

  public async d3graphvizProcessor(source: string, el: HTMLElement, _: MarkdownPostProcessorContext): Promise<void> {
    console.debug('Call d3graphvizProcessor');
    const div = document.createElement('div');
    const graphId = 'd3graph_' + createHash('md5').update(source).digest('hex').substring(0, 6);
    div.setAttr('id', graphId);
    div.setAttr('style', 'text-align: center');
    el.appendChild(div);
    const script = document.createElement('script');
    // graphviz(graphId).renderDot(source); => does not work, ideas how to use it?
    // Besides, sometimes d3 is undefined, so there must be a proper way to integrate d3.
    const escapedSource = source.replaceAll('\\', '\\\\').replaceAll('`', '\\`');
    script.text =
      `if( typeof d3 != 'undefined') { 
        d3.select("#${graphId}").graphviz()
        .onerror(d3error)
       .renderDot(\`${escapedSource}\`);
    }
    function d3error (err) {
        d3.select("#${graphId}").html(\`<div class="d3graphvizError"> d3.graphviz(): \`+err.toString()+\`</div>\`);
        console.error('Caught error on ${graphId}: ', err);
    }`;
    el.appendChild(script);
  }
}
