const { Transform } = require('stream');
const debug = require('debug')('ebml:encoder');
const Buffers = require('buffers');
const tools = require('./tools.js');
const schema = require('./schema.js');

module.exports = class EbmlEncoder extends Transform {
  constructor(options = {}) {
    super({ ...options, writableObjectMode: true });

    this.m_schema = schema;
    this.m_buffer = null;
    this.m_corked = false;

    this.m_stack = [];
  }

  _transform(chunk, enc, done) {
    debug(`encode ${chunk[0]} ${chunk[1].name}`);

    switch (chunk[0]) {
      case 'start':
        this.startTag(chunk[1].name, chunk[1]);
        break;
      case 'tag':
        this.writeTag(chunk[1].name, chunk[1].data);
        break;
      case 'end':
        this.endTag(chunk[1].name);
        break;
      default:
        break;
    }

    done();
  }

  /**
   * @private
   * @param {Function} done To be called after flush
   */
  prvFlush(done = () => {}) {
    if (!this.m_buffer || this.m_corked) {
      debug('no buffer/nothing pending');
      done();

      return;
    }

    debug(`writing ${this.m_buffer.length} bytes`);

    const chunk = this.m_buffer.toBuffer();
    this.m_buffer = null;
    this.push(chunk);
    done();
  }

  /**
     * @private
     * @param {Buffer} buffer
     */
  prvBufferAndFlush(buffer) {
    if (this.m_buffer) {
      this.m_buffer.push(buffer);
    } else {
      this.m_buffer = Buffers([buffer]);
    }
    this.prvFlush();
  }

  getSchemaInfo(tagName) {
    const tagStrs = Object.keys(this.m_schema).find(
      tagStr => this.m_schema[tagStr].name === tagName,
    );
    if (tagStrs) {
      return Buffer.from(tagStrs, 'hex');
    }

    return null;
  }

  cork() {
    this.m_corked = true;
  }

  uncork() {
    this.m_corked = false;
    this.prvFlush();
  }

  /* eslint-disable class-methods-use-this */
  /**
     * Encodes tag and data to a buffer
     *
     * @param {number|string} tagId The identifier of the tag
     * @param {Uint8Array} tagData the data to be encoded
     * @param {number} end The place to stop encoding; if -1, treat it as streaming
     * @returns {Buffers} the encoded tag
     */
  static encodeTag(tagId, tagData, end = 0) {
    return Buffers([
      tagId,
      end === -1
        ? Buffer.from('01ffffffffffffff', 'hex')
        : tools.writeVint(tagData.length),
      tagData,
    ]);
  }
  /* eslint-enable class-methods-use-this */

  writeTag(tagName, tagData) {
    const tagId = this.getSchemaInfo(tagName);
    if (!tagId) {
      throw new Error(`No schema entry found for ${tagName}`);
    }

    const data = EbmlEncoder.encodeTag(tagId, tagData);
    if (this.m_stack.length > 0) {
      this.m_stack[this.m_stack.length - 1].children.push({ data });
    } else {
      this.prvBufferAndFlush(data.toBuffer());
    }
  }

  startTag(tagName, info) {
    const tagId = this.getSchemaInfo(tagName);
    if (!tagId) {
      throw new Error(`No schema entry found for ${tagName}`);
    }

    const tag = {
      id: tagId,
      name: tagName,
      end: info.end,
      children: [],
    };

    if (this.m_stack.length > 0) {
      this.m_stack[this.m_stack.length - 1].children.push(tag);
    }
    this.m_stack.push(tag);
  }

  endTag() {
    const tag = this.m_stack.pop();

    const childTagDataBuffers = tag.children.map(child => child.data);
    tag.data = EbmlEncoder.encodeTag(
      tag.id,
      Buffers(childTagDataBuffers),
      tag.end,
    );

    if (this.m_stack.length < 1) {
      this.prvBufferAndFlush(tag.data.toBuffer());
    }
  }
};
