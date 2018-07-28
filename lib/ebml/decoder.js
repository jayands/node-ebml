const { Transform } = require('stream');
const debug = require('debug')('ebml:decoder');
const tools = require('./tools.js');
const schema = require('./schema.js');

const STATE_TAG = 1;
const STATE_SIZE = 2;
const STATE_CONTENT = 3;

module.exports = class EbmlDecoder extends Transform {
  constructor(options = {}) {
    super({ ...options, readableObjectMode: true });

    this.m_u8Buffer = null;
    this.m_tagStack = [];
    this.m_iState = STATE_TAG;
    this.m_cursor = 0;
    this.m_cTotal = 0;
    this.m_schema = schema;
  }

  /**
     * Transform a chunk
     *
     * @private
     * @param {Iterable<number>} chunk The chunk to transform
     * @param {string} enc the encoding
     * @param {Function} done a callable function after transformation
     */
  _transform(chunk, enc, done) {
    if (this.m_u8Buffer === null) {
      this.m_u8Buffer = new Uint8Array(chunk);
    } else {
      this.m_u8Buffer = tools.concatenate(
        this.m_u8Buffer,
        new Uint8Array(chunk),
      );
    }

    while (this.m_cursor < this.m_u8Buffer.length) {
      if (this.m_iState === STATE_TAG && !this.readTag()) {
        break;
      }
      if (this.m_iState === STATE_SIZE && !this.readSize()) {
        break;
      }
      if (this.m_iState === STATE_CONTENT && !this.readContent()) {
        break;
      }
    }

    done();
  }

  get state() {
    return this.m_iState;
  }

  get buffer() {
    return this.m_u8Buffer;
  }

  get cursor() {
    return this.m_cursor;
  }

  getSchemaInfo(tagStr) {
    return (
      this.m_schema[tagStr] || {
        type: 'unknown',
        name: 'unknown',
      }
    );
  }

  readTag() {
    debug('parsing tag');

    if (this.m_cursor >= this.m_u8Buffer.length) {
      debug('waiting for more data');

      return false;
    }

    const start = this.m_cTotal;
    const tag = tools.readVint(this.m_u8Buffer, this.m_cursor);

    if (tag == null) {
      debug('waiting for more data');

      return false;
    }

    const tagStr = tools.readHexString(
      this.m_u8Buffer,
      this.m_cursor,
      this.m_cursor + tag.length,
    );

    this.m_cursor += tag.length;
    this.m_cTotal += tag.length;
    this.m_iState = STATE_SIZE;

    const tagObj = {
      tag: tag.value,
      tagStr,
      type: this.getSchemaInfo(tagStr).type,
      name: this.getSchemaInfo(tagStr).name,
      start,
      end: start + tag.length,
    };

    this.m_tagStack.push(tagObj);
    debug(`read tag: ${tagStr}`);

    return true;
  }

  readSize() {
    const tagObj = this.m_tagStack[this.m_tagStack.length - 1];

    debug(`parsing size for tag: ${tagObj.tagStr}`);

    if (this.m_cursor >= this.m_u8Buffer.length) {
      debug('waiting for more data');

      return false;
    }

    const size = tools.readVint(this.m_u8Buffer, this.m_cursor);

    if (size == null) {
      debug('waiting for more data');

      return false;
    }

    this.m_cursor += size.length;
    this.m_cTotal += size.length;
    this.m_iState = STATE_CONTENT;
    tagObj.dataSize = size.value;

    // unknown size
    if (size.value === -1) {
      tagObj.end = -1;
    } else {
      tagObj.end += size.value + size.length;
    }

    debug(`read size: ${size.value}`);

    return true;
  }

  readContent() {
    const tagObj = this.m_tagStack[this.m_tagStack.length - 1];

    debug(`parsing content for tag: ${tagObj.tagStr}`);

    if (tagObj.type === 'm') {
      debug('content should be tags');
      this.push(['start', tagObj]);
      this.m_iState = STATE_TAG;

      return true;
    }

    if (this.m_u8Buffer.length < this.m_cursor + tagObj.dataSize) {
      debug(`got: ${this.m_u8Buffer.length}`);
      debug(`need: ${this.m_cursor + tagObj.dataSize}`);
      debug('waiting for more data');

      return false;
    }

    const data = this.m_u8Buffer.subarray(
      this.m_cursor,
      this.m_cursor + tagObj.dataSize,
    );
    this.m_cTotal += tagObj.dataSize;
    this.m_iState = STATE_TAG;
    this.m_u8Buffer = this.m_u8Buffer.subarray(
      this.m_cursor + tagObj.dataSize,
    );
    this.m_cursor = 0;

    this.m_tagStack.pop(); // remove the object from the stack

    this.push(['tag', tools.readDataFromTag(tagObj, Buffer.from(data))]);

    while (this.m_tagStack.length > 0) {
      const topEle = this.m_tagStack[this.m_tagStack.length - 1];
      if (this.m_cTotal < topEle.end) {
        break;
      }
      this.push(['end', topEle]);
      this.m_tagStack.pop();
    }

    debug(`read data: ${data.toString('hex')}`);

    return true;
  }
};
