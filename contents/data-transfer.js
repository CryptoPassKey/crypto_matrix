/* Local QRCode encoder: Kazuhiko Arase, MIT; source notices retained below. */
(function(){'use strict';const modules={"./QR8bitByte":function(module,exports,require){
var QRMode = require('./QRMode');
var ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
var ALPHANUMERIC_PATTERN = /^[0-9A-Z $%*+./:-]*$/;

function QR8bitByte(data) {
	this.mode = ALPHANUMERIC_PATTERN.test(data) ? QRMode.MODE_ALPHA_NUM : QRMode.MODE_8BIT_BYTE;
	this.data = data;
}

QR8bitByte.prototype = {

	getLength : function() {
		return this.data.length;
	},
	
	write : function(buffer) {
		if (this.mode === QRMode.MODE_ALPHA_NUM) {
			var i = 0;
			for (; i + 1 < this.data.length; i += 2) {
				var first = ALPHANUMERIC.indexOf(this.data.charAt(i));
				var second = ALPHANUMERIC.indexOf(this.data.charAt(i + 1));
				buffer.put(first * 45 + second, 11);
			}
			if (i < this.data.length) {
				buffer.put(ALPHANUMERIC.indexOf(this.data.charAt(i)), 6);
			}
			return;
		}
		for (var j = 0; j < this.data.length; j++) {
			// not JIS ...
			buffer.put(this.data.charCodeAt(j), 8);
		}
	}
};

module.exports = QR8bitByte;

},
"./QRBitBuffer":function(module,exports,require){
function QRBitBuffer() {
	this.buffer = [];
	this.length = 0;
}

QRBitBuffer.prototype = {

	get : function(index) {
		var bufIndex = Math.floor(index / 8);
		return ( (this.buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
	},
	
	put : function(num, length) {
		for (var i = 0; i < length; i++) {
			this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
		}
	},
	
	getLengthInBits : function() {
		return this.length;
	},
	
	putBit : function(bit) {
	
		var bufIndex = Math.floor(this.length / 8);
		if (this.buffer.length <= bufIndex) {
			this.buffer.push(0);
		}
	
		if (bit) {
			this.buffer[bufIndex] |= (0x80 >>> (this.length % 8) );
		}
	
		this.length++;
	}
};

module.exports = QRBitBuffer;

},
"./QRErrorCorrectLevel":function(module,exports,require){
module.exports = {
	L : 1,
	M : 0,
	Q : 3,
	H : 2
};


},
"./QRMaskPattern":function(module,exports,require){
module.exports = {
	PATTERN000 : 0,
	PATTERN001 : 1,
	PATTERN010 : 2,
	PATTERN011 : 3,
	PATTERN100 : 4,
	PATTERN101 : 5,
	PATTERN110 : 6,
	PATTERN111 : 7
};

},
"./QRMath":function(module,exports,require){
var QRMath = {

	glog : function(n) {
	
		if (n < 1) {
			throw new Error("glog(" + n + ")");
		}
		
		return QRMath.LOG_TABLE[n];
	},
	
	gexp : function(n) {
	
		while (n < 0) {
			n += 255;
		}
	
		while (n >= 256) {
			n -= 255;
		}
	
		return QRMath.EXP_TABLE[n];
	},
	
	EXP_TABLE : new Array(256),
	
	LOG_TABLE : new Array(256)

};
	
for (var i = 0; i < 8; i++) {
	QRMath.EXP_TABLE[i] = 1 << i;
}
for (var i = 8; i < 256; i++) {
	QRMath.EXP_TABLE[i] = QRMath.EXP_TABLE[i - 4]
		^ QRMath.EXP_TABLE[i - 5]
		^ QRMath.EXP_TABLE[i - 6]
		^ QRMath.EXP_TABLE[i - 8];
}
for (var i = 0; i < 255; i++) {
	QRMath.LOG_TABLE[QRMath.EXP_TABLE[i] ] = i;
}

module.exports = QRMath;

},
"./QRMode":function(module,exports,require){
module.exports = {
    MODE_NUMBER :       1 << 0,
    MODE_ALPHA_NUM :    1 << 1,
    MODE_8BIT_BYTE :    1 << 2,
    MODE_KANJI :        1 << 3
};

},
"./QRPolynomial":function(module,exports,require){
var QRMath = require('./QRMath');

function QRPolynomial(num, shift) {
	if (num.length === undefined) {
		throw new Error(num.length + "/" + shift);
	}

	var offset = 0;

	while (offset < num.length && num[offset] === 0) {
		offset++;
	}

	this.num = new Array(num.length - offset + shift);
	for (var i = 0; i < num.length - offset; i++) {
		this.num[i] = num[i + offset];
	}
}

QRPolynomial.prototype = {

	get : function(index) {
		return this.num[index];
	},
	
	getLength : function() {
		return this.num.length;
	},
	
	multiply : function(e) {
	
		var num = new Array(this.getLength() + e.getLength() - 1);
	
		for (var i = 0; i < this.getLength(); i++) {
			for (var j = 0; j < e.getLength(); j++) {
				num[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i) ) + QRMath.glog(e.get(j) ) );
			}
		}
	
		return new QRPolynomial(num, 0);
	},
	
	mod : function(e) {
	
		if (this.getLength() - e.getLength() < 0) {
			return this;
		}
	
		var ratio = QRMath.glog(this.get(0) ) - QRMath.glog(e.get(0) );
	
		var num = new Array(this.getLength() );
		
		for (var i = 0; i < this.getLength(); i++) {
			num[i] = this.get(i);
		}
		
		for (var x = 0; x < e.getLength(); x++) {
			num[x] ^= QRMath.gexp(QRMath.glog(e.get(x) ) + ratio);
		}
	
		// recursive call
		return new QRPolynomial(num, 0).mod(e);
	}
};

module.exports = QRPolynomial;

},
"./QRRSBlock":function(module,exports,require){
var QRErrorCorrectLevel = require('./QRErrorCorrectLevel');

function QRRSBlock(totalCount, dataCount) {
	this.totalCount = totalCount;
	this.dataCount  = dataCount;
}

QRRSBlock.RS_BLOCK_TABLE = [

	// L
	// M
	// Q
	// H

	// 1
	[1, 26, 19],
	[1, 26, 16],
	[1, 26, 13],
	[1, 26, 9],
	
	// 2
	[1, 44, 34],
	[1, 44, 28],
	[1, 44, 22],
	[1, 44, 16],

	// 3
	[1, 70, 55],
	[1, 70, 44],
	[2, 35, 17],
	[2, 35, 13],

	// 4		
	[1, 100, 80],
	[2, 50, 32],
	[2, 50, 24],
	[4, 25, 9],
	
	// 5
	[1, 134, 108],
	[2, 67, 43],
	[2, 33, 15, 2, 34, 16],
	[2, 33, 11, 2, 34, 12],
	
	// 6
	[2, 86, 68],
	[4, 43, 27],
	[4, 43, 19],
	[4, 43, 15],
	
	// 7		
	[2, 98, 78],
	[4, 49, 31],
	[2, 32, 14, 4, 33, 15],
	[4, 39, 13, 1, 40, 14],
	
	// 8
	[2, 121, 97],
	[2, 60, 38, 2, 61, 39],
	[4, 40, 18, 2, 41, 19],
	[4, 40, 14, 2, 41, 15],
	
	// 9
	[2, 146, 116],
	[3, 58, 36, 2, 59, 37],
	[4, 36, 16, 4, 37, 17],
	[4, 36, 12, 4, 37, 13],
	
	// 10		
	[2, 86, 68, 2, 87, 69],
	[4, 69, 43, 1, 70, 44],
	[6, 43, 19, 2, 44, 20],
	[6, 43, 15, 2, 44, 16],

	// 11
	[4, 101, 81],
	[1, 80, 50, 4, 81, 51],
	[4, 50, 22, 4, 51, 23],
	[3, 36, 12, 8, 37, 13],

	// 12
	[2, 116, 92, 2, 117, 93],
	[6, 58, 36, 2, 59, 37],
	[4, 46, 20, 6, 47, 21],
	[7, 42, 14, 4, 43, 15],

	// 13
	[4, 133, 107],
	[8, 59, 37, 1, 60, 38],
	[8, 44, 20, 4, 45, 21],
	[12, 33, 11, 4, 34, 12],

	// 14
	[3, 145, 115, 1, 146, 116],
	[4, 64, 40, 5, 65, 41],
	[11, 36, 16, 5, 37, 17],
	[11, 36, 12, 5, 37, 13],

	// 15
	[5, 109, 87, 1, 110, 88],
	[5, 65, 41, 5, 66, 42],
	[5, 54, 24, 7, 55, 25],
	[11, 36, 12],

	// 16
	[5, 122, 98, 1, 123, 99],
	[7, 73, 45, 3, 74, 46],
	[15, 43, 19, 2, 44, 20],
	[3, 45, 15, 13, 46, 16],

	// 17
	[1, 135, 107, 5, 136, 108],
	[10, 74, 46, 1, 75, 47],
	[1, 50, 22, 15, 51, 23],
	[2, 42, 14, 17, 43, 15],

	// 18
	[5, 150, 120, 1, 151, 121],
	[9, 69, 43, 4, 70, 44],
	[17, 50, 22, 1, 51, 23],
	[2, 42, 14, 19, 43, 15],

	// 19
	[3, 141, 113, 4, 142, 114],
	[3, 70, 44, 11, 71, 45],
	[17, 47, 21, 4, 48, 22],
	[9, 39, 13, 16, 40, 14],

	// 20
	[3, 135, 107, 5, 136, 108],
	[3, 67, 41, 13, 68, 42],
	[15, 54, 24, 5, 55, 25],
	[15, 43, 15, 10, 44, 16],

	// 21
	[4, 144, 116, 4, 145, 117],
	[17, 68, 42],
	[17, 50, 22, 6, 51, 23],
	[19, 46, 16, 6, 47, 17],

	// 22
	[2, 139, 111, 7, 140, 112],
	[17, 74, 46],
	[7, 54, 24, 16, 55, 25],
	[34, 37, 13],

	// 23
	[4, 151, 121, 5, 152, 122],
	[4, 75, 47, 14, 76, 48],
	[11, 54, 24, 14, 55, 25],
	[16, 45, 15, 14, 46, 16],

	// 24
	[6, 147, 117, 4, 148, 118],
	[6, 73, 45, 14, 74, 46],
	[11, 54, 24, 16, 55, 25],
	[30, 46, 16, 2, 47, 17],

	// 25
	[8, 132, 106, 4, 133, 107],
	[8, 75, 47, 13, 76, 48],
	[7, 54, 24, 22, 55, 25],
	[22, 45, 15, 13, 46, 16],

	// 26
	[10, 142, 114, 2, 143, 115],
	[19, 74, 46, 4, 75, 47],
	[28, 50, 22, 6, 51, 23],
	[33, 46, 16, 4, 47, 17],

	// 27
	[8, 152, 122, 4, 153, 123],
	[22, 73, 45, 3, 74, 46],
	[8, 53, 23, 26, 54, 24],
	[12, 45, 15, 28, 46, 16],

	// 28
	[3, 147, 117, 10, 148, 118],
	[3, 73, 45, 23, 74, 46],
	[4, 54, 24, 31, 55, 25],
	[11, 45, 15, 31, 46, 16],

	// 29
	[7, 146, 116, 7, 147, 117],
	[21, 73, 45, 7, 74, 46],
	[1, 53, 23, 37, 54, 24],
	[19, 45, 15, 26, 46, 16],

	// 30
	[5, 145, 115, 10, 146, 116],
	[19, 75, 47, 10, 76, 48],
	[15, 54, 24, 25, 55, 25],
	[23, 45, 15, 25, 46, 16],

	// 31
	[13, 145, 115, 3, 146, 116],
	[2, 74, 46, 29, 75, 47],
	[42, 54, 24, 1, 55, 25],
	[23, 45, 15, 28, 46, 16],

	// 32
	[17, 145, 115],
	[10, 74, 46, 23, 75, 47],
	[10, 54, 24, 35, 55, 25],
	[19, 45, 15, 35, 46, 16],

	// 33
	[17, 145, 115, 1, 146, 116],
	[14, 74, 46, 21, 75, 47],
	[29, 54, 24, 19, 55, 25],
	[11, 45, 15, 46, 46, 16],

	// 34
	[13, 145, 115, 6, 146, 116],
	[14, 74, 46, 23, 75, 47],
	[44, 54, 24, 7, 55, 25],
	[59, 46, 16, 1, 47, 17],

	// 35
	[12, 151, 121, 7, 152, 122],
	[12, 75, 47, 26, 76, 48],
	[39, 54, 24, 14, 55, 25],
	[22, 45, 15, 41, 46, 16],

	// 36
	[6, 151, 121, 14, 152, 122],
	[6, 75, 47, 34, 76, 48],
	[46, 54, 24, 10, 55, 25],
	[2, 45, 15, 64, 46, 16],

	// 37
	[17, 152, 122, 4, 153, 123],
	[29, 74, 46, 14, 75, 47],
	[49, 54, 24, 10, 55, 25],
	[24, 45, 15, 46, 46, 16],

	// 38
	[4, 152, 122, 18, 153, 123],
	[13, 74, 46, 32, 75, 47],
	[48, 54, 24, 14, 55, 25],
	[42, 45, 15, 32, 46, 16],

	// 39
	[20, 147, 117, 4, 148, 118],
	[40, 75, 47, 7, 76, 48],
	[43, 54, 24, 22, 55, 25],
	[10, 45, 15, 67, 46, 16],

	// 40
	[19, 148, 118, 6, 149, 119],
	[18, 75, 47, 31, 76, 48],
	[34, 54, 24, 34, 55, 25],
	[20, 45, 15, 61, 46, 16]
];

QRRSBlock.getRSBlocks = function(typeNumber, errorCorrectLevel) {
	
	var rsBlock = QRRSBlock.getRsBlockTable(typeNumber, errorCorrectLevel);
	
	if (rsBlock === undefined) {
		throw new Error("bad rs block @ typeNumber:" + typeNumber + "/errorCorrectLevel:" + errorCorrectLevel);
	}

	var length = rsBlock.length / 3;
	
	var list = [];
	
	for (var i = 0; i < length; i++) {

		var count = rsBlock[i * 3 + 0];
		var totalCount = rsBlock[i * 3 + 1];
		var dataCount  = rsBlock[i * 3 + 2];

		for (var j = 0; j < count; j++) {
			list.push(new QRRSBlock(totalCount, dataCount) );	
		}
	}
	
	return list;
};

QRRSBlock.getRsBlockTable = function(typeNumber, errorCorrectLevel) {

	switch(errorCorrectLevel) {
	case QRErrorCorrectLevel.L :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
	case QRErrorCorrectLevel.M :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
	case QRErrorCorrectLevel.Q :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
	case QRErrorCorrectLevel.H :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
	default :
		return undefined;
	}
};

module.exports = QRRSBlock;

},
"./QRUtil":function(module,exports,require){
var QRMode = require('./QRMode');
var QRPolynomial = require('./QRPolynomial');
var QRMath = require('./QRMath');
var QRMaskPattern = require('./QRMaskPattern');

var QRUtil = {

    PATTERN_POSITION_TABLE : [
        [],
        [6, 18],
        [6, 22],
        [6, 26],
        [6, 30],
        [6, 34],
        [6, 22, 38],
        [6, 24, 42],
        [6, 26, 46],
        [6, 28, 50],
        [6, 30, 54],        
        [6, 32, 58],
        [6, 34, 62],
        [6, 26, 46, 66],
        [6, 26, 48, 70],
        [6, 26, 50, 74],
        [6, 30, 54, 78],
        [6, 30, 56, 82],
        [6, 30, 58, 86],
        [6, 34, 62, 90],
        [6, 28, 50, 72, 94],
        [6, 26, 50, 74, 98],
        [6, 30, 54, 78, 102],
        [6, 28, 54, 80, 106],
        [6, 32, 58, 84, 110],
        [6, 30, 58, 86, 114],
        [6, 34, 62, 90, 118],
        [6, 26, 50, 74, 98, 122],
        [6, 30, 54, 78, 102, 126],
        [6, 26, 52, 78, 104, 130],
        [6, 30, 56, 82, 108, 134],
        [6, 34, 60, 86, 112, 138],
        [6, 30, 58, 86, 114, 142],
        [6, 34, 62, 90, 118, 146],
        [6, 30, 54, 78, 102, 126, 150],
        [6, 24, 50, 76, 102, 128, 154],
        [6, 28, 54, 80, 106, 132, 158],
        [6, 32, 58, 84, 110, 136, 162],
        [6, 26, 54, 82, 110, 138, 166],
        [6, 30, 58, 86, 114, 142, 170]
    ],

    G15 : (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0),
    G18 : (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0),
    G15_MASK : (1 << 14) | (1 << 12) | (1 << 10)    | (1 << 4) | (1 << 1),

    getBCHTypeInfo : function(data) {
        var d = data << 10;
        while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15) >= 0) {
            d ^= (QRUtil.G15 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15) ) );    
        }
        return ( (data << 10) | d) ^ QRUtil.G15_MASK;
    },

    getBCHTypeNumber : function(data) {
        var d = data << 12;
        while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18) >= 0) {
            d ^= (QRUtil.G18 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18) ) );    
        }
        return (data << 12) | d;
    },

    getBCHDigit : function(data) {

        var digit = 0;

        while (data !== 0) {
            digit++;
            data >>>= 1;
        }

        return digit;
    },

    getPatternPosition : function(typeNumber) {
        return QRUtil.PATTERN_POSITION_TABLE[typeNumber - 1];
    },

    getMask : function(maskPattern, i, j) {
        
        switch (maskPattern) {
            
        case QRMaskPattern.PATTERN000 : return (i + j) % 2 === 0;
        case QRMaskPattern.PATTERN001 : return i % 2 === 0;
        case QRMaskPattern.PATTERN010 : return j % 3 === 0;
        case QRMaskPattern.PATTERN011 : return (i + j) % 3 === 0;
        case QRMaskPattern.PATTERN100 : return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 === 0;
        case QRMaskPattern.PATTERN101 : return (i * j) % 2 + (i * j) % 3 === 0;
        case QRMaskPattern.PATTERN110 : return ( (i * j) % 2 + (i * j) % 3) % 2 === 0;
        case QRMaskPattern.PATTERN111 : return ( (i * j) % 3 + (i + j) % 2) % 2 === 0;

        default :
            throw new Error("bad maskPattern:" + maskPattern);
        }
    },

    getErrorCorrectPolynomial : function(errorCorrectLength) {

        var a = new QRPolynomial([1], 0);

        for (var i = 0; i < errorCorrectLength; i++) {
            a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0) );
        }

        return a;
    },

    getLengthInBits : function(mode, type) {

        if (1 <= type && type < 10) {

            // 1 - 9

            switch(mode) {
            case QRMode.MODE_NUMBER     : return 10;
            case QRMode.MODE_ALPHA_NUM  : return 9;
            case QRMode.MODE_8BIT_BYTE  : return 8;
            case QRMode.MODE_KANJI      : return 8;
            default :
                throw new Error("mode:" + mode);
            }

        } else if (type < 27) {

            // 10 - 26

            switch(mode) {
            case QRMode.MODE_NUMBER     : return 12;
            case QRMode.MODE_ALPHA_NUM  : return 11;
            case QRMode.MODE_8BIT_BYTE  : return 16;
            case QRMode.MODE_KANJI      : return 10;
            default :
                throw new Error("mode:" + mode);
            }

        } else if (type < 41) {

            // 27 - 40

            switch(mode) {
            case QRMode.MODE_NUMBER     : return 14;
            case QRMode.MODE_ALPHA_NUM  : return 13;
            case QRMode.MODE_8BIT_BYTE  : return 16;
            case QRMode.MODE_KANJI      : return 12;
            default :
                throw new Error("mode:" + mode);
            }

        } else {
            throw new Error("type:" + type);
        }
    },

    getLostPoint : function(qrCode) {
        
        var moduleCount = qrCode.getModuleCount();
        var lostPoint = 0;
        var row = 0; 
        var col = 0;

        
        // LEVEL1
        
        for (row = 0; row < moduleCount; row++) {

            for (col = 0; col < moduleCount; col++) {

                var sameCount = 0;
                var dark = qrCode.isDark(row, col);

                for (var r = -1; r <= 1; r++) {

                    if (row + r < 0 || moduleCount <= row + r) {
                        continue;
                    }

                    for (var c = -1; c <= 1; c++) {

                        if (col + c < 0 || moduleCount <= col + c) {
                            continue;
                        }

                        if (r === 0 && c === 0) {
                            continue;
                        }

                        if (dark === qrCode.isDark(row + r, col + c) ) {
                            sameCount++;
                        }
                    }
                }

                if (sameCount > 5) {
                    lostPoint += (3 + sameCount - 5);
                }
            }
        }

        // LEVEL2

        for (row = 0; row < moduleCount - 1; row++) {
            for (col = 0; col < moduleCount - 1; col++) {
                var count = 0;
                if (qrCode.isDark(row,     col    ) ) count++;
                if (qrCode.isDark(row + 1, col    ) ) count++;
                if (qrCode.isDark(row,     col + 1) ) count++;
                if (qrCode.isDark(row + 1, col + 1) ) count++;
                if (count === 0 || count === 4) {
                    lostPoint += 3;
                }
            }
        }

        // LEVEL3

        for (row = 0; row < moduleCount; row++) {
            for (col = 0; col < moduleCount - 6; col++) {
                if (qrCode.isDark(row, col) && 
                        !qrCode.isDark(row, col + 1) && 
                         qrCode.isDark(row, col + 2) && 
                         qrCode.isDark(row, col + 3) && 
                         qrCode.isDark(row, col + 4) && 
                        !qrCode.isDark(row, col + 5) && 
                         qrCode.isDark(row, col + 6) ) {
                    lostPoint += 40;
                }
            }
        }

        for (col = 0; col < moduleCount; col++) {
            for (row = 0; row < moduleCount - 6; row++) {
                if (qrCode.isDark(row, col) &&
                        !qrCode.isDark(row + 1, col) &&
                         qrCode.isDark(row + 2, col) &&
                         qrCode.isDark(row + 3, col) &&
                         qrCode.isDark(row + 4, col) &&
                        !qrCode.isDark(row + 5, col) &&
                         qrCode.isDark(row + 6, col) ) {
                    lostPoint += 40;
                }
            }
        }

        // LEVEL4
        
        var darkCount = 0;

        for (col = 0; col < moduleCount; col++) {
            for (row = 0; row < moduleCount; row++) {
                if (qrCode.isDark(row, col) ) {
                    darkCount++;
                }
            }
        }
        
        var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
        lostPoint += ratio * 10;

        return lostPoint;       
    }

};

module.exports = QRUtil;

},
"./index":function(module,exports,require){
//---------------------------------------------------------------------
// QRCode for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//   http://www.opensource.org/licenses/mit-license.php
//
// The word "QR Code" is registered trademark of 
// DENSO WAVE INCORPORATED
//   http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------
// Modified to work in node for this project (and some refactoring)
//---------------------------------------------------------------------

var QR8bitByte = require('./QR8bitByte');
var QRUtil = require('./QRUtil');
var QRPolynomial = require('./QRPolynomial');
var QRRSBlock = require('./QRRSBlock');
var QRBitBuffer = require('./QRBitBuffer');

function QRCode(typeNumber, errorCorrectLevel) {
	this.typeNumber = typeNumber;
	this.errorCorrectLevel = errorCorrectLevel;
	this.modules = null;
	this.moduleCount = 0;
	this.dataCache = null;
	this.dataList = [];
}

QRCode.prototype = {
	
	addData : function(data) {
		var newData = new QR8bitByte(data);
		this.dataList.push(newData);
		this.dataCache = null;
	},
	
	isDark : function(row, col) {
		if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) {
			throw new Error(row + "," + col);
		}
		return this.modules[row][col];
	},

	getModuleCount : function() {
		return this.moduleCount;
	},
	
	make : function() {
		// Calculate automatically typeNumber if provided is < 1
		if (this.typeNumber < 1 ){
			var typeNumber = 1;
			for (typeNumber = 1; typeNumber <= 40; typeNumber++) {
				var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, this.errorCorrectLevel);

				var buffer = new QRBitBuffer();
				var totalDataCount = 0;
				for (var i = 0; i < rsBlocks.length; i++) {
					totalDataCount += rsBlocks[i].dataCount;
				}

				for (var x = 0; x < this.dataList.length; x++) {
					var data = this.dataList[x];
					buffer.put(data.mode, 4);
					buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber) );
					data.write(buffer);
				}
				if (buffer.getLengthInBits() <= totalDataCount * 8)
					break;
			}
			if (typeNumber > 40) {
				throw new Error("code length overflow. Payload exceeds QR Version 40 capacity.");
			}
			this.typeNumber = typeNumber;
		}
		this.makeImpl(false, this.getBestMaskPattern() );
	},
	
	makeImpl : function(test, maskPattern) {
		
		this.moduleCount = this.typeNumber * 4 + 17;
		this.modules = new Array(this.moduleCount);
		
		for (var row = 0; row < this.moduleCount; row++) {
			
			this.modules[row] = new Array(this.moduleCount);
			
			for (var col = 0; col < this.moduleCount; col++) {
				this.modules[row][col] = null;//(col + row) % 3;
			}
		}
	
		this.setupPositionProbePattern(0, 0);
		this.setupPositionProbePattern(this.moduleCount - 7, 0);
		this.setupPositionProbePattern(0, this.moduleCount - 7);
		this.setupPositionAdjustPattern();
		this.setupTimingPattern();
		this.setupTypeInfo(test, maskPattern);
		
		if (this.typeNumber >= 7) {
			this.setupTypeNumber(test);
		}
	
		if (this.dataCache === null) {
			this.dataCache = QRCode.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
		}
	
		this.mapData(this.dataCache, maskPattern);
	},

	setupPositionProbePattern : function(row, col)  {
		
		for (var r = -1; r <= 7; r++) {
			
			if (row + r <= -1 || this.moduleCount <= row + r) continue;
			
			for (var c = -1; c <= 7; c++) {
				
				if (col + c <= -1 || this.moduleCount <= col + c) continue;
				
				if ( (0 <= r && r <= 6 && (c === 0 || c === 6) ) || 
                     (0 <= c && c <= 6 && (r === 0 || r === 6) ) || 
                     (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
					this.modules[row + r][col + c] = true;
				} else {
					this.modules[row + r][col + c] = false;
				}
			}		
		}		
	},
	
	getBestMaskPattern : function() {
	
		var minLostPoint = 0;
		var pattern = 0;
	
		for (var i = 0; i < 8; i++) {
			
			this.makeImpl(true, i);
	
			var lostPoint = QRUtil.getLostPoint(this);
	
			if (i === 0 || minLostPoint >  lostPoint) {
				minLostPoint = lostPoint;
				pattern = i;
			}
		}
	
		return pattern;
	},
	
	createMovieClip : function(target_mc, instance_name, depth) {
	
		var qr_mc = target_mc.createEmptyMovieClip(instance_name, depth);
		var cs = 1;
	
		this.make();

		for (var row = 0; row < this.modules.length; row++) {
			
			var y = row * cs;
			
			for (var col = 0; col < this.modules[row].length; col++) {
	
				var x = col * cs;
				var dark = this.modules[row][col];
			
				if (dark) {
					qr_mc.beginFill(0, 100);
					qr_mc.moveTo(x, y);
					qr_mc.lineTo(x + cs, y);
					qr_mc.lineTo(x + cs, y + cs);
					qr_mc.lineTo(x, y + cs);
					qr_mc.endFill();
				}
			}
		}
		
		return qr_mc;
	},

	setupTimingPattern : function() {
		
		for (var r = 8; r < this.moduleCount - 8; r++) {
			if (this.modules[r][6] !== null) {
				continue;
			}
			this.modules[r][6] = (r % 2 === 0);
		}
	
		for (var c = 8; c < this.moduleCount - 8; c++) {
			if (this.modules[6][c] !== null) {
				continue;
			}
			this.modules[6][c] = (c % 2 === 0);
		}
	},
	
	setupPositionAdjustPattern : function() {
	
		var pos = QRUtil.getPatternPosition(this.typeNumber);
		
		for (var i = 0; i < pos.length; i++) {
		
			for (var j = 0; j < pos.length; j++) {
			
				var row = pos[i];
				var col = pos[j];
				
				if (this.modules[row][col] !== null) {
					continue;
				}
				
				for (var r = -2; r <= 2; r++) {
				
					for (var c = -2; c <= 2; c++) {
					
						if (Math.abs(r) === 2 || 
                            Math.abs(c) === 2 ||
                            (r === 0 && c === 0) ) {
							this.modules[row + r][col + c] = true;
						} else {
							this.modules[row + r][col + c] = false;
						}
					}
				}
			}
		}
	},
	
	setupTypeNumber : function(test) {
	
		var bits = QRUtil.getBCHTypeNumber(this.typeNumber);
        var mod;
	
		for (var i = 0; i < 18; i++) {
			mod = (!test && ( (bits >> i) & 1) === 1);
			this.modules[Math.floor(i / 3)][i % 3 + this.moduleCount - 8 - 3] = mod;
		}
	
		for (var x = 0; x < 18; x++) {
			mod = (!test && ( (bits >> x) & 1) === 1);
			this.modules[x % 3 + this.moduleCount - 8 - 3][Math.floor(x / 3)] = mod;
		}
	},
	
	setupTypeInfo : function(test, maskPattern) {
	
		var data = (this.errorCorrectLevel << 3) | maskPattern;
		var bits = QRUtil.getBCHTypeInfo(data);
        var mod;
	
		// vertical		
		for (var v = 0; v < 15; v++) {
	
			mod = (!test && ( (bits >> v) & 1) === 1);
	
			if (v < 6) {
				this.modules[v][8] = mod;
			} else if (v < 8) {
				this.modules[v + 1][8] = mod;
			} else {
				this.modules[this.moduleCount - 15 + v][8] = mod;
			}
		}
	
		// horizontal
		for (var h = 0; h < 15; h++) {
	
			mod = (!test && ( (bits >> h) & 1) === 1);
			
			if (h < 8) {
				this.modules[8][this.moduleCount - h - 1] = mod;
			} else if (h < 9) {
				this.modules[8][15 - h - 1 + 1] = mod;
			} else {
				this.modules[8][15 - h - 1] = mod;
			}
		}
	
		// fixed module
		this.modules[this.moduleCount - 8][8] = (!test);
	
	},
	
	mapData : function(data, maskPattern) {
		
		var inc = -1;
		var row = this.moduleCount - 1;
		var bitIndex = 7;
		var byteIndex = 0;
		
		for (var col = this.moduleCount - 1; col > 0; col -= 2) {
	
			if (col === 6) col--;
	
			while (true) {
	
				for (var c = 0; c < 2; c++) {
					
					if (this.modules[row][col - c] === null) {
						
						var dark = false;
	
						if (byteIndex < data.length) {
							dark = ( ( (data[byteIndex] >>> bitIndex) & 1) === 1);
						}
	
						var mask = QRUtil.getMask(maskPattern, row, col - c);
	
						if (mask) {
							dark = !dark;
						}
						
						this.modules[row][col - c] = dark;
						bitIndex--;
	
						if (bitIndex === -1) {
							byteIndex++;
							bitIndex = 7;
						}
					}
				}
								
				row += inc;
	
				if (row < 0 || this.moduleCount <= row) {
					row -= inc;
					inc = -inc;
					break;
				}
			}
		}
		
	}

};

QRCode.PAD0 = 0xEC;
QRCode.PAD1 = 0x11;

QRCode.createData = function(typeNumber, errorCorrectLevel, dataList) {
	
	var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
	
	var buffer = new QRBitBuffer();
	
	for (var i = 0; i < dataList.length; i++) {
		var data = dataList[i];
		buffer.put(data.mode, 4);
		buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber) );
		data.write(buffer);
	}

	// calc num max data.
	var totalDataCount = 0;
	for (var x = 0; x < rsBlocks.length; x++) {
		totalDataCount += rsBlocks[x].dataCount;
	}

	if (buffer.getLengthInBits() > totalDataCount * 8) {
		throw new Error("code length overflow. (" + 
            buffer.getLengthInBits() + 
            ">" +  
            totalDataCount * 8 + 
            ")");
	}

	// end code
	if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
		buffer.put(0, 4);
	}

	// padding
	while (buffer.getLengthInBits() % 8 !== 0) {
		buffer.putBit(false);
	}

	// padding
	while (true) {
		
		if (buffer.getLengthInBits() >= totalDataCount * 8) {
			break;
		}
		buffer.put(QRCode.PAD0, 8);
		
		if (buffer.getLengthInBits() >= totalDataCount * 8) {
			break;
		}
		buffer.put(QRCode.PAD1, 8);
	}

	return QRCode.createBytes(buffer, rsBlocks);
};

QRCode.createBytes = function(buffer, rsBlocks) {

	var offset = 0;
	
	var maxDcCount = 0;
	var maxEcCount = 0;
	
	var dcdata = new Array(rsBlocks.length);
	var ecdata = new Array(rsBlocks.length);
	
	for (var r = 0; r < rsBlocks.length; r++) {

		var dcCount = rsBlocks[r].dataCount;
		var ecCount = rsBlocks[r].totalCount - dcCount;

		maxDcCount = Math.max(maxDcCount, dcCount);
		maxEcCount = Math.max(maxEcCount, ecCount);
		
		dcdata[r] = new Array(dcCount);
		
		for (var i = 0; i < dcdata[r].length; i++) {
			dcdata[r][i] = 0xff & buffer.buffer[i + offset];
		}
		offset += dcCount;
		
		var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
		var rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);

		var modPoly = rawPoly.mod(rsPoly);
		ecdata[r] = new Array(rsPoly.getLength() - 1);
		for (var x = 0; x < ecdata[r].length; x++) {
            var modIndex = x + modPoly.getLength() - ecdata[r].length;
			ecdata[r][x] = (modIndex >= 0)? modPoly.get(modIndex) : 0;
		}

	}
	
	var totalCodeCount = 0;
	for (var y = 0; y < rsBlocks.length; y++) {
		totalCodeCount += rsBlocks[y].totalCount;
	}

	var data = new Array(totalCodeCount);
	var index = 0;

	for (var z = 0; z < maxDcCount; z++) {
		for (var s = 0; s < rsBlocks.length; s++) {
			if (z < dcdata[s].length) {
				data[index++] = dcdata[s][z];
			}
		}
	}

	for (var xx = 0; xx < maxEcCount; xx++) {
		for (var t = 0; t < rsBlocks.length; t++) {
			if (xx < ecdata[t].length) {
				data[index++] = ecdata[t][xx];
			}
		}
	}

	return data;

};

module.exports = QRCode;

}};const cache={};function req(name){if(cache[name])return cache[name].exports;const m={exports:{}};cache[name]=m;if(!modules[name])throw Error('QR module missing');modules[name](m,m.exports,req);return m.exports;}const QR=req('./index'),level=req('./QRErrorCorrectLevel');window.DataTransferQRCode={matrix:function(text){if(!/^[\x00-\x7f]*$/.test(text))throw Error('QR payload must be ASCII');try{const q=new QR(-1,level.M);q.addData(text);q.make();return q.modules;}catch(_){const q=new QR(-1,level.L);q.addData(text);q.make();return q.modules;}},modeFor:function(text){if(!/^[\x00-\x7f]*$/.test(text))throw Error('QR payload must be ASCII');const q=new QR(-1,level.M);q.addData(text);return q.dataList[0].mode;}};if(!window.MatrixQRCode)window.MatrixQRCode=window.DataTransferQRCode;})();

/* ===== Crypto Matrix — Data Transfer (Tab 7) Production Controller ===== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var valueOf = function (id, fallback) {
    var el = $(id);
    return el && el.value !== undefined ? el.value : fallback;
  };
  var setValue = function (id, value) {
    var el = $(id);
    if (el) el.value = value;
  };
  var isLightTheme = function () {
    return typeof document !== 'undefined' &&
      document.documentElement &&
      document.documentElement.classList.contains('light');
  };
  var storePref = function (key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, String(val));
    } catch (_) {
      return null;
    }
  };

  function initDataTransferApp() {
    var section = $('datatransfer-section');
    if (!section || section.dataset.dtInitialized === '1') return;
    section.dataset.dtInitialized = '1';

    var Core = window.DataTransferCore;
    var Fountain = window.DataTransferFountain;
    var Wire = window.DataTransferWire;
    var QRGen = window.DataTransferQRCode || window.MatrixQRCode;

    var MAX_TRANSFER_BYTES = 64 * 1024 * 1024;
    var TX_QR_CACHE_MAX_BYTES = 64 * 1024 * 1024;
    var MAX_INGEST_QUEUE = 16;

    // Sub-tab state ('tx' | 'rx')
    var activeSubTab = 'tx';

    // TX state
    var txSelectedFile = null;
    var txPlan = null;
    var txFountainEncoder = null;
    var txFountainPart = null;
    var txMode = 'hybrid-data';
    var txHybridPhase = 'legacy';
    var txCurrentBlocks = new Set();
    var txMapSelectedIndex = 0;
    var txIndex = 0;
    var txInitialIndex = 0;
    var txTimer = 0;
    var txRafId = 0;
    var txFrameStartTime = 0;
    var txIsRendering = false;
    var txPausedByVisibility = false;
    var txPlaying = false;
    var txRenderGeneration = 0;
    var txQrMatrixCache = [];
    var txFountainQrCache = [];
    var txFountainQrCacheIndex = 1;
    var txQrCacheBytes = 0;
    var txCurrentLabel = '';
    var txPreparedChunkBytes = 800;
    var txPreparedSourceName = '';
    var txPreparedSourceSize = 0;
    var txPreparedWireSize = 0;

    // RX state
    var rx = Core ? new Core.Receiver() : null;
    var fountainRx = Fountain ? new Fountain.Receiver() : null;
    var activeProtocol = null;
    var hybridFountainMeta = null;
    var hybridImportedBlocks = new Set();
    var rxFirstFrameCaptured = false;
    var rxDirectBlocks = new Set();
    var rxCurrentBlocks = new Set();
    var rxCurrentLabel = '';
    var stream = null;
    var detector = null;
    var zxingDecoder = null;
    var scannerType = '';
    var scannerName = '未初期化';
    var scanBusy = false;
    var scanTimer = 0;
    var scanVideoFrameCallback = null;
    var scanLatestPresentedFrames = null;
    var scanLastAnalyzedPresentedFrames = null;
    var scanLastIngestedRawText = '';
    var scanConsecutiveNoQrCount = 0;
    var scanIngestQueue = [];
    var scanIngestBusy = false;
    var scanCachedContext = null;
    var rxWorker = null;
    var rxWorkerReady = false;
    var rxWorkerBusy = false;
    var rxWorkerFailed = false;
    var rxWorkerRequestId = 0;
    var rxScanSessionId = 0;
    var uniqueFrameCount = 0;
    var scanAttempts = 0;
    var scanHits = 0;
    var transferTiming = { startedAt: null, endedAt: null, frameCount: 0 };
    var objectUrl = null;
    var receivedDone = false;
    var rxTransferId = '';
    var rxFinalBytes = null;
    var rxFinalFilename = 'received-file.bin';
    var rxFinalText = null;

    // Restore persisted user preferences
    var savedFps = Number(storePref('cm-dt-fps'));
    if (Number.isFinite(savedFps) && savedFps >= 3 && savedFps <= 60) {
      setValue('dt-fps', String(Math.round(savedFps)));
    }
    var savedChunk = Number(storePref('cm-dt-chunk'));
    if (Number.isFinite(savedChunk) && savedChunk >= 80 && savedChunk <= 2800) {
      var roundedChunk = Math.max(80, Math.min(2800, Math.round(savedChunk / 20) * 20));
      setValue('dt-chunk-size', String(roundedChunk));
      setValue('dt-chunk-size-number', String(roundedChunk));
    }
    var savedFallback = storePref('cm-dt-fallback');
    if (savedFallback === 'true' || savedFallback === '1') {
      if ($('dt-rx-allow-fallback')) $('dt-rx-allow-fallback').checked = true;
    }

    function setHeaderBadge(label, state) {
      var badge = $('dt-state-badge');
      if (!badge) return;
      badge.textContent = label;
      badge.setAttribute('data-state', state || 'IDLE');
    }

    function setStatus(id, message, kind) {
      var el = $(id);
      if (!el) return;
      el.textContent = message;
      el.className = 'dt-status-bar' + (kind ? ' dt-status-' + kind : '');
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + ' KiB';
      return (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1) + ' MiB';
    }

    function formatRate(bytes, elapsedMs) {
      if (!Number.isFinite(bytes) || bytes < 0 || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return '—';
      var kibPerSecond = bytes * 1000 / elapsedMs / 1024;
      return kibPerSecond.toFixed(2) + ' KB/s';
    }

    function formatElapsedMs(milliseconds) {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
      if (milliseconds < 1000) return (milliseconds / 1000).toFixed(2) + '秒';
      var totalSeconds = Math.floor(milliseconds / 1000);
      var hours = Math.floor(totalSeconds / 3600);
      var minutes = Math.floor((totalSeconds % 3600) / 60);
      var seconds = totalSeconds % 60;
      var tenths = Math.floor((milliseconds % 1000) / 100);
      var mm = String(minutes).padStart(2, '0');
      var ss = String(seconds).padStart(2, '0');
      if (hours > 0) return String(hours).padStart(2, '0') + ':' + mm + ':' + ss;
      if (minutes > 0) return mm + ':' + ss;
      return seconds + '.' + tenths + '秒';
    }

    function recordTransferFrame(timing, firstFramePending, duplicate, now) {
      if (!timing || firstFramePending || duplicate) return false;
      if (timing.startedAt === null) {
        timing.startedAt = now;
        timing.endedAt = null;
        timing.frameCount = 1;
        return true;
      }
      if (timing.endedAt === null) timing.frameCount++;
      return false;
    }

    function elapsedTransferMs(timing, now) {
      if (!timing || timing.startedAt === null) return null;
      var endAt = timing.endedAt === null ? now : timing.endedAt;
      return Math.max(0, endAt - timing.startedAt);
    }

    function packNamedPayload(payload, filename) {
      if (!(payload instanceof Uint8Array)) payload = new Uint8Array(payload);
      var nameBytes = new TextEncoder().encode(String(filename || 'received-file.bin'));
      if (!nameBytes.length || nameBytes.length > 4096) {
        throw new Error('ファイル名メタデータの長さが不正です');
      }
      var headerLength = 16;
      var output = new Uint8Array(headerLength + nameBytes.length + payload.length);
      output.set([0x41, 0x47, 0x4c, 0x46, 0x4e, 0x30, 0x30, 0x31], 0); // AGLFN001
      var view = new DataView(output.buffer);
      view.setUint32(8, nameBytes.length, false);
      view.setUint32(12, payload.length, false);
      output.set(nameBytes, headerLength);
      output.set(payload, headerLength + nameBytes.length);
      return output;
    }

    function unpackNamedPayload(value) {
      var payload = value instanceof Uint8Array ? value : new Uint8Array(value);
      var magic = [0x41, 0x47, 0x4c, 0x46, 0x4e, 0x30, 0x30, 0x31]; // AGLFN001
      if (payload.length < 8 || magic.some(function (byte, index) { return payload[index] !== byte; })) {
        return { bytes: payload.slice(), filename: null, named: false };
      }
      if (payload.length < 16) throw new Error('ファイル名メタデータのヘッダーが途中で切れています');
      var view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      var nameLength = view.getUint32(8, false);
      var dataLength = view.getUint32(12, false);
      if (!nameLength || nameLength > 4096 || dataLength > MAX_TRANSFER_BYTES ||
          16 + nameLength + dataLength !== payload.length) {
        throw new Error('ファイル名メタデータの長さが不正です');
      }
      var filename = new TextDecoder('utf-8', { fatal: true })
        .decode(payload.subarray(16, 16 + nameLength));
      return {
        bytes: payload.slice(16 + nameLength),
        filename: filename,
        named: true
      };
    }

    function safeFilename(value) {
      return String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
    }

    function tryDecodeUtf8Text(bytes) {
      if (!(bytes instanceof Uint8Array)) return null;
      if (bytes.length === 0) return '';
      if (bytes.length > 512 * 1024) return null; // Avoid sluggish DOM rendering for huge text
      // Reject binary data containing null bytes or control characters (except tab/LF/CR)
      for (var i = 0; i < Math.min(bytes.length, 8192); i++) {
        var b = bytes[i];
        if (b === 0 || (b < 32 && b !== 9 && b !== 10 && b !== 13)) return null;
      }
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (_) {
        return null;
      }
    }

    /* ---------- Block Map Renderer (Light & Dark Mode Aware) ---------- */
    function drawBlockMap(canvasId, total, directSet, recoveredSet, activeSet, activeFill, focusIndex) {
      var canvas = $(canvasId);
      if (!canvas) return;
      total = Math.max(0, Number(total) || 0);
      var light = isLightTheme();

      var columns = total ? Math.min(50, total) : 50;
      var rows = Math.max(1, Math.ceil(total / columns));
      var cell = Math.max(4, Math.min(12, Math.floor(4096 / rows)));

      canvas.width = columns * cell;
      canvas.height = rows * cell;
      var context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = light ? '#e2e8f0' : '#0f172a';
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (!total) return;

      var missingColor = light ? '#cbd5e1' : '#334155';
      var directColor = light ? '#10b981' : '#20d69a';
      var recoveredColor = light ? '#f59e0b' : '#ffc247';
      var activeColor = light ? '#0284c7' : '#00e5ff';

      for (var index = 0; index < total; index++) {
        var color = missingColor;
        if (directSet && directSet.has(index)) color = directColor;
        if (recoveredSet && recoveredSet.has(index)) color = recoveredColor;
        if (activeFill && activeSet && activeSet.has(index)) color = activeColor;
        var x = (index % columns) * cell;
        var y = Math.floor(index / columns) * cell;
        context.fillStyle = color;
        context.fillRect(x, y, cell - 1, cell - 1);
        if (activeSet && activeSet.has(index)) {
          if (cell >= 4) {
            context.strokeStyle = light ? '#0f172a' : '#ffffff';
            context.lineWidth = 2;
            context.strokeRect(x + 0.5, y + 0.5, cell - 2, cell - 2);
          }
        }
        if (focusIndex === index) {
          context.save();
          context.setLineDash([2, 1]);
          context.strokeStyle = light ? '#d97706' : '#ffd166';
          context.lineWidth = 1.5;
          context.strokeRect(x + 0.75, y + 0.75, Math.max(0, cell - 1.5), Math.max(0, cell - 1.5));
          context.restore();
        }
      }
    }

    function txBlockTotal() {
      if (txMode === 'fountain' && txFountainEncoder) return txFountainEncoder.seqLen;
      return txPlan ? txPlan.dataFrames.length : 0;
    }

    function updateTxBlockMap() {
      var canvas = $('dt-tx-blockmap');
      if (!canvas) return;
      var total = txBlockTotal();
      if (total) {
        txMapSelectedIndex = Math.max(0, Math.min(total - 1, txMapSelectedIndex));
        canvas.tabIndex = 0;
        canvas.setAttribute('aria-disabled', 'false');
        canvas.setAttribute('aria-valuemax', String(total));
        canvas.setAttribute('aria-valuenow', String(txMapSelectedIndex + 1));
        canvas.setAttribute('aria-valuetext', 'ブロック ' + (txMapSelectedIndex + 1) + ' を選択');
        var focusIndex = document.activeElement === canvas ? txMapSelectedIndex : -1;
        drawBlockMap('dt-tx-blockmap', total, null, null, txCurrentBlocks, true, focusIndex);
        if ($('dt-tx-block-summary')) {
          $('dt-tx-block-summary').textContent =
            '全 ' + total + ' ブロック · 現在位置: ' + (txCurrentLabel || '待機中') +
            '（セルをタップすると1周目のそのブロックから再開します）';
        }
      } else {
        canvas.tabIndex = -1;
        canvas.setAttribute('aria-disabled', 'true');
        canvas.setAttribute('aria-valuemax', '1');
        canvas.setAttribute('aria-valuenow', '1');
        canvas.setAttribute('aria-valuetext', '転送データなし');
        drawBlockMap('dt-tx-blockmap', 0, null, null, null, false, -1);
        if ($('dt-tx-block-summary')) {
          $('dt-tx-block-summary').textContent = '「QRコードを準備」を実行すると、送信ブロックマップが表示されます。';
        }
      }
    }

    function updateRxBlockMap() {
      var have = 0;
      var total = 0;
      var directSet = null;
      var recoveredSet = null;
      if (activeProtocol === 'fountain' || activeProtocol === 'hybrid') {
        have = fountainRx ? fountainRx.simpleParts.size : 0;
        total = fountainRx ? fountainRx.seqLen : 0;
        directSet = fountainRx ? fountainRx.directIndexes : null;
        recoveredSet = fountainRx ? fountainRx.recoveredIndexes : null;
      } else if (rx) {
        have = rx.shards.size;
        total = rx.total;
        directSet = rxDirectBlocks;
        recoveredSet = new Set();
        rx.shards.forEach(function (_v, idx) {
          if (!rxDirectBlocks.has(idx)) recoveredSet.add(idx);
        });
      }
      drawBlockMap('dt-rx-blockmap', total, directSet, recoveredSet, null, false, -1);
      if ($('dt-rx-block-summary')) {
        if (total > 0) {
          $('dt-rx-block-summary').textContent =
            '取得済み: ' + have + ' / ' + total + ' ブロック（直接取得: ' +
            (directSet ? directSet.size : 0) + ' · LT復元: ' +
            (recoveredSet ? recoveredSet.size : 0) + ' · 未取得: ' + Math.max(0, total - have) + '）';
        } else {
          $('dt-rx-block-summary').textContent = 'QRコードの読み取りを開始すると、ブロックごとの取得状態が表示されます。';
        }
      }
    }

    function blockIndexFromPoint(x, y, canvasWidth, canvasHeight, total) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || total < 1 || canvasWidth < 1 || canvasHeight < 1 ||
          x < 0 || y < 0 || x >= canvasWidth || y >= canvasHeight) return -1;
      var columns = Math.min(50, total);
      var rows = Math.max(1, Math.ceil(total / columns));
      var cell = Math.max(4, Math.min(12, Math.floor(4096 / rows)));
      var column = Math.floor(x / cell);
      var row = Math.floor(y / cell);
      if (column >= columns || row >= rows) return -1;
      var index = row * columns + column;
      return index < total ? index : -1;
    }

    function packetBlockIndexes(packet) {
      if (!packet || !Number.isSafeInteger(packet.total) || packet.total < 1) {
        throw new Error('ブロック位置を計算できないQRフレームです');
      }
      if (packet.type === 'data') {
        if (!Number.isSafeInteger(packet.index) || packet.index < 0 || packet.index >= packet.total) {
          throw new Error('データ片のブロック番号が不正です');
        }
        return [packet.index];
      }
      if (packet.type === 'parity') {
        var start = packet.group * 8;
        var count = Math.min(8, packet.total - start);
        return Array.from({ length: count }, function (_, offset) { return start + offset; });
      }
      throw new Error('未対応のQRフレーム種別です');
    }

    function legacyFrameIndexForBlock(blockIndex, plan) {
      if (!plan || !Number.isSafeInteger(blockIndex) || blockIndex < 0 || blockIndex >= plan.dataFrames.length) return -1;
      var groupSize = plan.groupSize || 8;
      var groupsBefore = Math.floor(blockIndex / groupSize);
      return blockIndex + (plan.parityFrames ? groupsBefore * 2 : 0);
    }

    /* ---------- Controls Sync ---------- */
    function syncChunkSizeControls(source) {
      var range = $('dt-chunk-size');
      var number = $('dt-chunk-size-number');
      if (!range || !number) return;
      var maximum = 2800;
      var requested = Number(source === 'number' ? number.value : range.value);
      if (!Number.isFinite(requested)) requested = 800;
      var value = Math.max(80, Math.min(maximum, Math.round(requested / 20) * 20));
      range.value = String(value);
      number.value = String(value);
      if ($('dt-chunk-size-value')) $('dt-chunk-size-value').textContent = value + ' B';
      storePref('cm-dt-chunk', value);

      if ((txPlan || txFountainEncoder) && value !== txPreparedChunkBytes) {
        setStatus('dt-tx-status',
          '1枚あたりのデータ量を ' + value + ' B に変更しました。反映するには「QRコードを準備」を押してください。',
          'warn');
      }
    }

    function syncFpsControls() {
      var fpsVal = Math.max(3, Math.min(60, Number(valueOf('dt-fps', '10')) || 10));
      setValue('dt-fps', String(fpsVal));
      if ($('dt-fps-value')) $('dt-fps-value').textContent = fpsVal + ' 枚/秒';
      storePref('cm-dt-fps', fpsVal);
      if (txPlan || txFountainEncoder) {
        if (txPlaying) {
          setStatus('dt-tx-status', '送信速度を ' + fpsVal + ' 枚/秒 に変更して送信中です。', 'info');
        } else {
          setStatus('dt-tx-status',
            '送信速度を ' + fpsVal + ' 枚/秒 に設定しました。「送信開始」または「先頭QRに戻す」で再開できます。',
            'info');
        }
      }
    }

    /* ---------- QR Matrix Cache & Rendering ---------- */
    function packQrMatrix(matrix) {
      var modules = matrix.length;
      var packed = new Uint8Array(Math.ceil(modules * modules / 8));
      for (var row = 0; row < modules; row++) {
        for (var col = 0; col < modules; col++) {
          if (matrix[row][col]) {
            var bitIndex = row * modules + col;
            packed[bitIndex >>> 3] |= 1 << (bitIndex & 7);
          }
        }
      }
      return { modules: modules, packed: packed, bytes: packed.byteLength + 16 };
    }

    function encodeQrMatrix(text) {
      if (!QRGen) throw new Error('QR生成モジュールが読み込まれていません');
      return packQrMatrix(QRGen.matrix(text));
    }

    async function createQrCacheEntry(text, scratchCanvas) {
      if (!QRGen) throw new Error('QR生成モジュールが読み込まれていません');
      var matrix = QRGen.matrix(text);
      var modules = matrix.length;
      var total = modules + 8;
      if (typeof createImageBitmap === 'function') {
        scratchCanvas.width = total;
        scratchCanvas.height = total;
        var scratchContext = scratchCanvas.getContext('2d', { alpha: false });
        var imageData = scratchContext.createImageData(total, total);
        imageData.data.fill(255);
        for (var row = 0; row < modules; row++) {
          for (var col = 0; col < modules; col++) {
            if (!matrix[row][col]) continue;
            var offset = ((row + 4) * total + col + 4) * 4;
            imageData.data[offset] = 0;
            imageData.data[offset + 1] = 0;
            imageData.data[offset + 2] = 0;
          }
        }
        scratchContext.putImageData(imageData, 0, 0);
        try {
          var bitmap = await createImageBitmap(scratchCanvas);
          return { bitmap: bitmap, width: total, height: total, bytes: total * total * 4 };
        } catch (_) {}
      }
      return packQrMatrix(matrix);
    }

    function disposeQrCache(entries) {
      if (!entries) return;
      for (var i = 0; i < entries.length; i++) {
        var qr = entries[i] && entries[i].qr;
        if (qr && qr.bitmap && typeof qr.bitmap.close === 'function') {
          try { qr.bitmap.close(); } catch (_) {}
        }
      }
    }

    function renderQrMatrix(entry) {
      if (!entry) throw new Error('事前生成QRキャッシュがありません');
      var canvas = $('dt-tx-canvas');
      if (!canvas) return;
      var context = canvas.getContext('2d', { alpha: false });
      var size = canvas.width;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, size, size);

      if (entry.bitmap) {
        context.imageSmoothingEnabled = false;
        context.drawImage(entry.bitmap, 0, 0, size, size);
        context.imageSmoothingEnabled = true;
        return { versionModules: entry.width - 8 };
      }

      var quiet = 4;
      var modules = entry.modules;
      var total = modules + quiet * 2;
      context.fillStyle = '#000000';
      context.beginPath();
      for (var row = 0; row < modules; row++) {
        var run = -1;
        for (var col = 0; col <= modules; col++) {
          var bitIndex = row * modules + col;
          var dark = col < modules && ((entry.packed[bitIndex >>> 3] >>> (bitIndex & 7)) & 1) !== 0;
          if (dark && run < 0) run = col;
          if (!dark && run >= 0) {
            var x0 = Math.floor((run + quiet) * size / total);
            var x1 = Math.ceil((col + quiet) * size / total);
            var y0 = Math.floor((row + quiet) * size / total);
            var y1 = Math.ceil((row + 1 + quiet) * size / total);
            context.rect(x0, y0, x1 - x0, y1 - y0);
            run = -1;
          }
        }
      }
      context.fill();
      return { versionModules: modules };
    }

    function renderQr(text) {
      return renderQrMatrix(encodeQrMatrix(text));
    }

    function clearQrCanvas() {
      var canvas = $('dt-tx-canvas');
      if (!canvas) return;
      var context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    async function prepareTxQrCache() {
      disposeQrCache(txQrMatrixCache);
      disposeQrCache(txFountainQrCache);
      txQrMatrixCache = [];
      txFountainQrCache = [];
      txFountainQrCacheIndex = 1;
      txQrCacheBytes = 0;
      var total = txPlan ? txPlan.frames.length : 0;
      var cache = [];
      var scratchCanvas = document.createElement('canvas');

      for (var i = 0; i < total; i++) {
        var frame = txPlan.frames[i];
        var qr = await createQrCacheEntry(frame, scratchCanvas);
        var entryBytes = qr.bytes || (qr.packed.byteLength + 16);
        var cacheLimitReached = cache.length > 0 &&
          txQrCacheBytes + entryBytes > TX_QR_CACHE_MAX_BYTES;
        cache.push({ frame: frame, qr: qr, part: null });
        txQrCacheBytes += entryBytes;
        if (cacheLimitReached) break;

        if ((i + 1) % 16 === 0) {
          setHeaderBadge('準備中 (' + cache.length + '/' + total + ')', 'PREPARING');
          setStatus('dt-tx-status', 'QRコードを事前生成しています: ' + cache.length + ' / ' + total + ' 枚…', 'info');
          await new Promise(function (resolve) { setTimeout(resolve, 0); });
        }
      }
      txQrMatrixCache = cache;
      return { cachedFrames: cache.length, totalFrames: total };
    }

    function updateTxPlayBadge() {
      var badge = $('dt-tx-play-badge');
      if (!badge) return;
      badge.hidden = true;
    }

    function updateTxActionButtons() {
      var hasData = !!(txPlan || txFountainEncoder);
      if ($('dt-play-tx')) $('dt-play-tx').disabled = !hasData || txPlaying;
      if ($('dt-pause-tx')) $('dt-pause-tx').disabled = !hasData || !txPlaying;
      if ($('dt-reset-tx-head')) $('dt-reset-tx-head').disabled = !hasData;
      updateTxPlayBadge();
    }

    /* ---------- TX Preparation & Playback ---------- */
    async function prepareTx() {
      stopTx();
      if ($('dt-prepare-tx')) $('dt-prepare-tx').disabled = true;
      setHeaderBadge('準備中', 'PREPARING');
      try {
        var file = txSelectedFile || ($('dt-tx-file') && $('dt-tx-file').files && $('dt-tx-file').files[0]);
        var sourceBytes;
        var sourceName;
        if (file) {
          if (file.size > MAX_TRANSFER_BYTES) throw new Error('最大転送サイズは64 MiBです');
          sourceBytes = new Uint8Array(await file.arrayBuffer());
          sourceName = file.name;
        } else {
          var text = valueOf('dt-tx-text', '');
          if (!text) throw new Error('送信するファイルを選択するか、テキストを入力してください');
          sourceBytes = new TextEncoder().encode(text);
          sourceName = 'message.txt';
        }
        if (sourceBytes.length > MAX_TRANSFER_BYTES) throw new Error('最大転送サイズは64 MiBです');

        var namedPayload = packNamedPayload(sourceBytes, sourceName);
        if (namedPayload.length > MAX_TRANSFER_BYTES) {
          throw new Error('ファイル名メタデータを含む転送データが64 MiBを超えています');
        }
        var packed = await Core.compressIfSmaller(namedPayload);
        var wireBytes = packed.bytes;

        var chunkBytes = Math.max(80, Math.min(2800, Number(valueOf('dt-chunk-size', '800')) || 800));
        if (Math.ceil(wireBytes.length / chunkBytes) > 100000) {
          throw new Error('このデータ量ではブロック数が100,000個を超えます。1枚あたりのデータ量を大きくしてください');
        }

        txMode = 'hybrid-data';
        txHybridPhase = 'legacy';
        txPlan = Core.buildFrames(wireBytes, {
          chunkSize: chunkBytes,
          parity: false,
          wireFormat: 'base45'
        });

        var firstFrame = txPlan.frames[0];
        var blockCount = txPlan.dataFrames.length;
        var firstPacket = Core.parseFrame(firstFrame);
        txCurrentBlocks = new Set(packetBlockIndexes(firstPacket));
        txCurrentLabel = 'Data 1 / ' + blockCount;

        txFountainEncoder = new Fountain.Encoder(wireBytes, {
          chunkSize: chunkBytes,
          id: txPlan.id,
          wireFormat: 'base45'
        });
        txFountainEncoder.startRepairPhase();
        txIndex = blockCount > 1 ? 1 : 0;
        txInitialIndex = txIndex;
        txMapSelectedIndex = 0;
        txPreparedChunkBytes = chunkBytes;
        txPreparedSourceName = sourceName;
        txPreparedSourceSize = sourceBytes.length;
        txPreparedWireSize = wireBytes.length;

        await prepareTxQrCache();

        var firstCacheEntry = txQrMatrixCache[0];
        if (firstCacheEntry && firstCacheEntry.qr) renderQrMatrix(firstCacheEntry.qr);
        else renderQr(firstFrame);

        txFrameStartTime = performance.now();
        if ($('dt-tx-placeholder')) $('dt-tx-placeholder').hidden = true;
        if ($('dt-tx-stat-state')) $('dt-tx-stat-state').textContent = '準備完了（先頭QR表示中）';
        if ($('dt-tx-stat-size')) {
          $('dt-tx-stat-size').textContent =
            formatBytes(sourceBytes.length) + ' · 全 ' + blockCount + ' ブロック';
        }
        if ($('dt-tx-stat-frame')) $('dt-tx-stat-frame').textContent = txCurrentLabel;
        if ($('dt-tx-progress-bar')) {
          $('dt-tx-progress-bar').style.width = (1 / Math.max(1, blockCount) * 100).toFixed(1) + '%';
        }
        updateTxBlockMap();
        updateTxActionButtons();
        setHeaderBadge('準備完了', 'READY');
        setStatus('dt-tx-status',
          '準備完了: ' + sourceName + '（' + formatBytes(sourceBytes.length) + ' / 全 ' + blockCount + ' ブロック）。' +
          (blockCount === 1
            ? '受信側のカメラで、このQRコードを読み取るだけで完了します。'
            : '受信側のカメラでこの先頭QRコードの読み取りを確認してから「送信開始」を押してください。'),
          'ok');
        return true;
      } catch (error) {
        txPlan = null;
        txFountainEncoder = null;
        txFountainPart = null;
        disposeQrCache(txQrMatrixCache);
        disposeQrCache(txFountainQrCache);
        txQrMatrixCache = [];
        txFountainQrCache = [];
        txQrCacheBytes = 0;
        if ($('dt-tx-placeholder')) $('dt-tx-placeholder').hidden = false;
        updateTxActionButtons();
        updateTxBlockMap();
        setHeaderBadge('エラー', 'ERROR');
        setStatus('dt-tx-status', 'QRコードの準備に失敗しました: ' + error.message, 'err');
        return false;
      } finally {
        if ($('dt-prepare-tx')) $('dt-prepare-tx').disabled = false;
      }
    }

    function stopTx(reasonMessage) {
      var wasPlaying = txPlaying;
      txPlaying = false;
      txIsRendering = false;
      txPausedByVisibility = false;
      txRenderGeneration++;
      if (txRafId) {
        cancelAnimationFrame(txRafId);
        txRafId = 0;
      }
      if (txTimer) {
        clearTimeout(txTimer);
        txTimer = 0;
      }
      updateTxActionButtons();
      if (txPlan || txFountainEncoder) {
        if ($('dt-tx-stat-state')) $('dt-tx-stat-state').textContent = '一時停止中';
        if (activeSubTab === 'tx') setHeaderBadge('一時停止中', 'PAUSED');
      }
      if (wasPlaying && reasonMessage) {
        setStatus('dt-tx-status', reasonMessage, 'info');
      }
    }

    function txAnimationLoop(now) {
      txRafId = 0;
      if (!txPlaying) return;
      if (typeof document !== 'undefined' && document.hidden) {
        txRafId = 0;
        return;
      }
      var tabPanel = $('tab-datatransfer');
      if (tabPanel && tabPanel.hidden) {
        stopTx('別タブへ移動したため、送信を一時停止しました。');
        return;
      }
      var effectiveFps = Math.max(3, Math.min(60, Number(valueOf('dt-fps', '10')) || 10));
      var targetInterval = 1000 / effectiveFps;
      if (!txFrameStartTime) txFrameStartTime = now;
      if (now - txFrameStartTime < targetInterval) {
        txRafId = requestAnimationFrame(txAnimationLoop);
        return;
      }
      if (txIsRendering) {
        txRafId = requestAnimationFrame(txAnimationLoop);
        return;
      }
      showNextFrame();
    }

    async function showNextFrame() {
      if (!txPlan && !txFountainEncoder) return;
      if (txIsRendering) return;
      txIsRendering = true;
      var renderGeneration = ++txRenderGeneration;
      txFrameStartTime = performance.now();
      try {
        var frame;
        var cachedQr = null;
        if (txHybridPhase === 'legacy' && txIndex >= txPlan.frames.length) {
          txHybridPhase = 'fountain';
          setStatus('dt-tx-status',
            '2周目以降（LT修復フレーム）を送信中です。受信側が完了するまでそのまま映し続けてください。',
            'info');
        }
        if (txHybridPhase === 'fountain') {
          var nextFountainPart = await txFountainEncoder.nextPart();
          if (renderGeneration !== txRenderGeneration || !txPlaying) return;
          txFountainPart = nextFountainPart;
          frame = txFountainPart.frame;
          txCurrentBlocks = new Set(txFountainPart.indexes);
          txCurrentLabel = 'LT修復 seq ' + txFountainPart.seqNum + ' · ' +
            (txFountainPart.indexes.length <= 4
              ? '対象 ' + txFountainPart.indexes.map(function (idx) { return idx + 1; }).join(',')
              : txFountainPart.indexes.length + 'ブロック合成');
          if ($('dt-tx-stat-state')) $('dt-tx-stat-state').textContent = '送信中（LT修復）';
          if ($('dt-tx-stat-frame')) $('dt-tx-stat-frame').textContent = txCurrentLabel;
          if ($('dt-tx-progress-bar')) $('dt-tx-progress-bar').style.width = '100%';
        } else {
          var legacyFrameIndex = txIndex;
          frame = txPlan.frames[legacyFrameIndex];
          cachedQr = txQrMatrixCache[legacyFrameIndex] ? txQrMatrixCache[legacyFrameIndex].qr : null;
          var parsed = Core.parseFrame(frame);
          txCurrentBlocks = new Set(packetBlockIndexes(parsed));
          txCurrentLabel = 'Data ' + (parsed.index + 1) + ' / ' + parsed.total;
          if ($('dt-tx-stat-state')) $('dt-tx-stat-state').textContent = '送信中（1周目 Data）';
          if ($('dt-tx-stat-frame')) $('dt-tx-stat-frame').textContent = txCurrentLabel;
          if ($('dt-tx-progress-bar')) {
            $('dt-tx-progress-bar').style.width = ((txIndex + 1) / txPlan.frames.length * 100).toFixed(1) + '%';
          }
          txIndex++;
        }
        if (renderGeneration !== txRenderGeneration || !txPlaying) return;
        if (cachedQr) renderQrMatrix(cachedQr);
        else renderQr(frame);
        updateTxBlockMap();
      } catch (error) {
        if (renderGeneration !== txRenderGeneration) return;
        stopTx();
        setHeaderBadge('エラー', 'ERROR');
        setStatus('dt-tx-status', 'QRコードの描画に失敗しました: ' + error.message, 'err');
      } finally {
        txIsRendering = false;
        if (txPlaying && !txRafId && !(typeof document !== 'undefined' && document.hidden)) {
          txRafId = requestAnimationFrame(txAnimationLoop);
        }
      }
    }

    function playTx() {
      if ((!txPlan && !txFountainEncoder) || txPlaying) return;
      txPlaying = true;
      txPausedByVisibility = false;
      updateTxActionButtons();
      if ($('dt-tx-stat-state')) {
        $('dt-tx-stat-state').textContent = txHybridPhase === 'fountain' ? '送信中（LT修復）' : '送信中（1周目 Data）';
      }
      setHeaderBadge('送信中', 'SENDING');
      setStatus('dt-tx-status', '送信中です。QRコードをタップすると一時停止、ブロックマップをタップするとその位置から再開できます。', 'info');
      txFrameStartTime = performance.now();
      if (!txRafId && !txIsRendering) {
        txRafId = requestAnimationFrame(txAnimationLoop);
      }
    }

    function toggleTxPlayback() {
      if (!txPlan && !txFountainEncoder) return;
      if (txPlaying) {
        stopTx('送信を一時停止しました。QRコードまたは「送信開始」で再開できます。');
      } else {
        playTx();
      }
    }

    function resetTxToFirstFrame() {
      if (!txPlan && !txFountainEncoder) {
        setStatus('dt-tx-status', '先に「QRコードを準備」を実行してください。', 'info');
        return;
      }
      stopTx();
      txIndex = txInitialIndex;
      txHybridPhase = 'legacy';
      txFountainQrCacheIndex = 1;
      if (txFountainEncoder && typeof txFountainEncoder.startRepairPhase === 'function') {
        txFountainEncoder.startRepairPhase();
      }
      txMapSelectedIndex = 0;
      if (txPlan && txPlan.frames[0]) {
        var firstPacket = Core.parseFrame(txPlan.frames[0]);
        txCurrentBlocks = new Set(packetBlockIndexes(firstPacket));
        txCurrentLabel = 'Data 1 / ' + txPlan.dataFrames.length;
        if (txQrMatrixCache[0] && txQrMatrixCache[0].qr) renderQrMatrix(txQrMatrixCache[0].qr);
        else renderQr(txPlan.frames[0]);
      }
      if ($('dt-tx-stat-frame')) $('dt-tx-stat-frame').textContent = txCurrentLabel;
      if ($('dt-tx-progress-bar')) {
        $('dt-tx-progress-bar').style.width =
          (txPlan ? (1 / Math.max(1, txPlan.dataFrames.length) * 100) : 0).toFixed(1) + '%';
      }
      updateTxBlockMap();
      if ($('dt-tx-stat-state')) $('dt-tx-stat-state').textContent = '準備完了（先頭QR表示中）';
      setHeaderBadge('準備完了', 'READY');
      setStatus('dt-tx-status',
        '先頭QRコード（Data 1）に戻しました。受信側でカメラ読み取りを確認してから「送信開始」を押してください。',
        'ok');
    }

    function seekTxToBlock(blockIndex) {
      var total = txBlockTotal();
      if (!total || !Number.isSafeInteger(blockIndex) || blockIndex < 0 || blockIndex >= total) return;
      try {
        if (txRafId) cancelAnimationFrame(txRafId);
        txRafId = 0;
        if (txTimer) clearTimeout(txTimer);
        txTimer = 0;
        txRenderGeneration++;
        txIsRendering = false;
        txPausedByVisibility = false;
        if (txPlan) {
          txHybridPhase = 'legacy';
          var frameIndex = legacyFrameIndexForBlock(blockIndex, txPlan);
          if (frameIndex < 0 || frameIndex >= txPlan.frames.length) {
            throw new Error('指定ブロックのフレーム位置が見つかりません');
          }
          txIndex = frameIndex;
        }
        txMapSelectedIndex = blockIndex;
        txPlaying = true;
        updateTxActionButtons();
        setHeaderBadge('送信中', 'SENDING');
        setStatus('dt-tx-status', '1周目のブロック ' + (blockIndex + 1) + ' から送信を再開しました。', 'info');
        showNextFrame();
      } catch (error) {
        setStatus('dt-tx-status', '再生位置の変更に失敗しました: ' + error.message, 'err');
      }
    }

    function clearTxData() {
      stopTx();
      disposeQrCache(txQrMatrixCache);
      disposeQrCache(txFountainQrCache);
      txQrMatrixCache = [];
      txFountainQrCache = [];
      txQrCacheBytes = 0;
      txPlan = null;
      txFountainEncoder = null;
      txFountainPart = null;
      txCurrentBlocks.clear();
      txCurrentLabel = '';
      txSelectedFile = null;
      txPreparedSourceName = '';
      txPreparedSourceSize = 0;
      txPreparedWireSize = 0;
      if ($('dt-tx-file')) $('dt-tx-file').value = '';
      if ($('dt-tx-file-chip')) $('dt-tx-file-chip').hidden = true;
      if ($('dt-tx-text')) $('dt-tx-text').value = '';
      if ($('dt-tx-text-meta')) $('dt-tx-text-meta').textContent = 'ファイル未選択時は、ここに入力したテキストが送信されます。';
      clearQrCanvas();
      if ($('dt-tx-placeholder')) $('dt-tx-placeholder').hidden = false;
      if ($('dt-tx-stat-state')) $('dt-tx-stat-state').textContent = '待機中';
      if ($('dt-tx-stat-size')) $('dt-tx-stat-size').textContent = '—';
      if ($('dt-tx-stat-frame')) $('dt-tx-stat-frame').textContent = '—';
      if ($('dt-tx-progress-bar')) $('dt-tx-progress-bar').style.width = '0%';
      updateTxActionButtons();
      updateTxBlockMap();
      if (activeSubTab === 'tx') setHeaderBadge('待機中', 'IDLE');
      setStatus('dt-tx-status', '送信データをクリアしました。ファイルまたはテキストを選択してください。', 'info');
    }

    /* ---------- RX Scanner, Camera & Completion ---------- */
    function updateRxStats() {
      var have = 0;
      var total = 0;
      var recovered = 0;
      if (activeProtocol === 'fountain' || activeProtocol === 'hybrid') {
        have = fountainRx ? fountainRx.simpleParts.size : 0;
        total = fountainRx ? fountainRx.seqLen : 0;
        recovered = fountainRx ? fountainRx.recoveredIndexes.size : 0;
      } else if (rx) {
        have = rx.shards.size;
        total = rx.total;
        recovered = rx.recoveredCount;
      }
      var pct = total ? (have / total * 100) : 0;
      if ($('dt-rx-progress-bar')) $('dt-rx-progress-bar').style.width = pct.toFixed(1) + '%';
      if ($('dt-rx-stat-progress')) {
        $('dt-rx-stat-progress').textContent = total ? (have + ' / ' + total + ' (' + pct.toFixed(0) + '%)') : '0 / 0';
      }
      if ($('dt-rx-stat-remaining')) {
        $('dt-rx-stat-remaining').textContent = total ? String(Math.max(0, total - have)) : '—';
      }
      if ($('dt-rx-stat-recovered')) {
        $('dt-rx-stat-recovered').textContent = String(recovered);
      }
      updateRxBlockMap();
    }

    function resetRx() {
      if (rx) rx.reset();
      if (fountainRx) fountainRx.reset();
      activeProtocol = null;
      hybridFountainMeta = null;
      hybridImportedBlocks.clear();
      rxFirstFrameCaptured = false;
      rxDirectBlocks.clear();
      rxCurrentBlocks.clear();
      rxCurrentLabel = '';
      uniqueFrameCount = 0;
      scanAttempts = 0;
      scanHits = 0;
      transferTiming.startedAt = null;
      transferTiming.endedAt = null;
      transferTiming.frameCount = 0;
      scanBusy = false;
      scanLatestPresentedFrames = null;
      scanLastAnalyzedPresentedFrames = null;
      scanLastIngestedRawText = '';
      scanConsecutiveNoQrCount = 0;
      scanIngestQueue = [];
      scanIngestBusy = false;
      rxWorkerBusy = false;
      receivedDone = false;
      rxTransferId = '';
      rxFinalBytes = null;
      rxFinalText = null;
      rxFinalFilename = 'received-file.bin';
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      if ($('dt-rx-completion-card')) $('dt-rx-completion-card').hidden = true;
      if ($('dt-rx-text-preview-wrap')) $('dt-rx-text-preview-wrap').hidden = true;
      if ($('dt-rx-text-preview')) $('dt-rx-text-preview').value = '';
      if ($('dt-copy-result')) $('dt-copy-result').hidden = true;
      updateRxStats();
      if (activeSubTab === 'rx') {
        setHeaderBadge(stream ? '読み取り中' : '待機中', stream ? 'SCANNING' : 'IDLE');
      }
      setStatus('dt-rx-status',
        stream
          ? '受信状態をリセットしました。送信側でQRコードの連続表示を先頭から開始してください。'
          : '待機中です。「カメラを起動」を押し、送信側でQRコードの連続表示を開始してください。',
        'info');
    }

    function triggerDownloadRxFile() {
      if (!rxFinalBytes) return;
      var customName = safeFilename(valueOf('dt-rx-filename-input', rxFinalFilename)) || rxFinalFilename || 'received-file.bin';
      var blob = new Blob([rxFinalBytes], { type: 'application/octet-stream' });
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = objectUrl;
      a.download = customName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus('dt-rx-status', '「' + customName + '」を保存しました。', 'ok');
    }

    async function copyRxTextResult() {
      if (rxFinalText === null) return;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(rxFinalText);
        } else {
          var ta = $('dt-rx-text-preview');
          if (ta) {
            ta.focus();
            ta.select();
            document.execCommand('copy');
          }
        }
        setStatus('dt-rx-status', '復元されたテキストをクリップボードにコピーしました。', 'ok');
      } catch (err) {
        setStatus('dt-rx-status', 'コピーに失敗しました: ' + err.message, 'err');
      }
    }

    async function finishReceive(bytes) {
      if (receivedDone) return;
      receivedDone = true;
      var unpacked = await Core.decompressIfWrapped(bytes);
      var named = unpackNamedPayload(unpacked.bytes);
      var finalBytes = named.bytes;
      var name = safeFilename(named.filename) || 'received-file.bin';
      rxFinalBytes = finalBytes;
      rxFinalFilename = name;
      rxFinalText = tryDecodeUtf8Text(finalBytes);

      var completedElapsedMs = elapsedTransferMs(transferTiming, performance.now());
      setValue('dt-rx-filename-input', name);
      if ($('dt-rx-completion-size')) {
        $('dt-rx-completion-size').textContent =
          formatBytes(finalBytes.length) + ' (' + finalBytes.length.toLocaleString() + ' B)';
      }
      if ($('dt-rx-completion-time')) {
        $('dt-rx-completion-time').textContent =
          completedElapsedMs === null ? '即時完了（1枚）' : formatElapsedMs(completedElapsedMs);
      }
      if ($('dt-rx-completion-speed')) {
        $('dt-rx-completion-speed').textContent =
          completedElapsedMs === null ? '—（単一QR）' : formatRate(finalBytes.length, completedElapsedMs);
      }

      if (rxFinalText !== null) {
        if ($('dt-rx-text-preview')) $('dt-rx-text-preview').value = rxFinalText;
        if ($('dt-rx-text-preview-wrap')) $('dt-rx-text-preview-wrap').hidden = false;
        if ($('dt-copy-result')) $('dt-copy-result').hidden = false;
      } else {
        if ($('dt-rx-text-preview-wrap')) $('dt-rx-text-preview-wrap').hidden = true;
        if ($('dt-copy-result')) $('dt-copy-result').hidden = true;
      }

      if ($('dt-rx-completion-card')) $('dt-rx-completion-card').hidden = false;
      updateRxStats();
      stopCamera();
      setHeaderBadge('完了', 'COMPLETED');
      setStatus('dt-rx-status',
        '✅ 転送が完了しました（CRC32検証済み）。ファイルを保存するか、テキストをコピーできます。',
        'ok');
    }

    function isInitialTransferFrame(rawText) {
      try {
        if (!Wire.isAirgapFrame(rawText)) return false;
        if (Wire.isFountainFrame(rawText)) return Fountain.parseFrame(rawText).seqNum === 1;
        var packet = Core.parseFrame(rawText);
        return packet.type === 'data' && packet.index === 0;
      } catch (_) { return false; }
    }

    async function ingest(rawText) {
      if (receivedDone) return;
      if (!Wire.isAirgapFrame(rawText)) return;
      try {
        var firstFramePending = !rxFirstFrameCaptured;
        if (firstFramePending && !isInitialTransferFrame(rawText)) {
          setStatus('dt-rx-status',
            '先頭QRコード（Data 1）ではありません。送信側で「先頭QRに戻す」を押して、先頭QRコードから読み取ってください。',
            'warn');
          return;
        }
        var isFountain = Wire.isFountainFrame(rawText);
        var hybridTransition = isFountain && activeProtocol === 'legacy';
        if (!isFountain && (activeProtocol === 'fountain' || activeProtocol === 'hybrid')) {
          throw new Error('同じ転送中に旧フレームへ戻ることはできません');
        }
        var result;
        if (isFountain) {
          var fountainPacket = Fountain.parseFrame(rawText);
          if (!rxTransferId) rxTransferId = fountainPacket.id;
          if (hybridTransition) {
            if (rx.id !== fountainPacket.id || rx.total !== fountainPacket.seqLen) {
              throw new Error('LT修復フレームが初回フレームと同じ転送ID／ブロック数ではありません');
            }
            hybridFountainMeta = fountainPacket;
            hybridImportedBlocks.clear();
            rx.shards.forEach(function (block, index) {
              fountainRx.addKnownBlock(hybridFountainMeta, index, block, rxDirectBlocks.has(index));
              hybridImportedBlocks.add(index);
            });
            activeProtocol = 'hybrid';
          } else if (activeProtocol === null) {
            activeProtocol = 'fountain';
          } else if (activeProtocol !== 'fountain' && activeProtocol !== 'hybrid') {
            throw new Error('別の転送方式のフレームです。「最初から」を押してリセットしてください');
          }
          result = await fountainRx.feed(rawText);
          var indexes = result.lastIndexes || await fountainRx.chooser.choose(fountainPacket.seqNum);
          rxCurrentBlocks = new Set(indexes);
        } else {
          var packet = Core.parseFrame(rawText);
          if (!rxTransferId) rxTransferId = packet.id;
          result = rx.feed(rawText);
          rxCurrentBlocks = new Set(packetBlockIndexes(packet));
          if (packet.type === 'data') {
            rxDirectBlocks.add(packet.index);
          }
          if (activeProtocol === null) activeProtocol = 'legacy';
        }
        var transferTimerStarted = recordTransferFrame(transferTiming, firstFramePending, result.duplicate, performance.now());
        if (firstFramePending) rxFirstFrameCaptured = true;
        if (!result.duplicate) uniqueFrameCount++;
        if (result.complete && transferTiming.startedAt !== null && transferTiming.endedAt === null) {
          transferTiming.endedAt = performance.now();
        }
        updateRxStats();
        if (!result.complete) {
          if (transferTimerStarted) {
            setHeaderBadge('読み取り中', 'SCANNING');
            setStatus('dt-rx-status', '転送を開始しました。そのままカメラをQRコードに向け続けてください。', 'ok');
          } else if (uniqueFrameCount <= 1) {
            setHeaderBadge('先頭QR確認済み', 'READY');
            setStatus('dt-rx-status', '先頭フレームを確認しました。送信側のQRコードを連続表示すると、残りのデータを自動で受信・復元します。', 'ok');
          } else if (isFountain) {
            setHeaderBadge('データ復元中', 'RECOVERING');
            setStatus('dt-rx-status',
              'LT修復フレームで欠損ブロックを復元しています… (' +
              fountainRx.simpleParts.size + ' / ' + fountainRx.seqLen + ')',
              'info');
          } else {
            setHeaderBadge('読み取り中', 'SCANNING');
            setStatus('dt-rx-status',
              'データを受信中です… (' + rx.shards.size + ' / ' + rx.total + ' ブロック)',
              'info');
          }
        }
        if (result.complete) {
          try {
            await finishReceive(result.bytes);
          } catch (error) {
            receivedDone = false;
            setHeaderBadge('エラー', 'ERROR');
            setStatus('dt-rx-status', '受信データの復元に失敗しました: ' + error.message, 'err');
          }
        }
      } catch (error) {
        setStatus('dt-rx-status', '読み取ったQRコードを処理できませんでした: ' + error.message, 'err');
      }
    }

    async function initScanner() {
      detector = null;
      zxingDecoder = null;
      scannerType = '';
      var allowFallback = $('dt-rx-allow-fallback') ? $('dt-rx-allow-fallback').checked : false;
      var wasmError = null;
      var nativeError = null;

      if ($('dt-scanner-mode')) $('dt-scanner-mode').textContent = 'QR読み取りエンジンを準備中…';

      // ZXing-C++ WASM remains the primary engine in both modes.
      try {
        if (!window.DataTransferZXingLoader || typeof window.DataTransferZXingLoader.load !== 'function') {
          throw new Error('ZXing WASMローダーが未読込です');
        }
        zxingDecoder = await window.DataTransferZXingLoader.load();
        if (!zxingDecoder || typeof zxingDecoder.readBarcodes !== 'function') {
          throw new Error('ZXing WASM APIが見つかりません');
        }
        scannerType = 'zxing-wasm';
        scannerName = 'ZXing-C++ WASM';
        if ($('dt-scanner-mode')) {
          $('dt-scanner-mode').textContent = allowFallback
            ? '読み取り方式: ZXing-C++ WASM（互換モード・優先）'
            : '読み取り方式: ZXing-C++ WASM（高速モード）';
        }
        return;
      } catch (error) {
        zxingDecoder = null;
        wasmError = error;
        if (!allowFallback) {
          throw new Error('ZXing-C++ WASMを初期化できませんでした: ' + error.message +
            '（互換モードを有効にすると代替方式を利用できます）');
        }
      }

      // Only when compatibility mode is enabled, try native BarcodeDetector.
      if (allowFallback && typeof window.BarcodeDetector === 'function') {
        try {
          var formats = await window.BarcodeDetector.getSupportedFormats();
          if (formats.indexOf('qr_code') !== -1) {
            detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            scannerType = 'native';
            scannerName = 'Native BarcodeDetector';
            if ($('dt-scanner-mode')) $('dt-scanner-mode').textContent = '読み取り方式: Native BarcodeDetector（互換フォールバック）';
            return;
          }
        } catch (error) {
          nativeError = error;
          detector = null;
        }
      } else if (allowFallback) {
        nativeError = new Error('BarcodeDetector APIを利用できません');
      }

      // Last-resort compatibility decoder.
      if (allowFallback && typeof window.jsQR === 'function') {
        scannerType = 'jsqr';
        scannerName = 'jsQR';
        if ($('dt-scanner-mode')) $('dt-scanner-mode').textContent = '読み取り方式: jsQR（互換フォールバック）';
        return;
      }

      throw new Error('利用可能なQR読み取りエンジンがありません: ZXing: ' +
        (wasmError ? wasmError.message : '利用不可') +
        ' / Native: ' + (nativeError ? nativeError.message : '利用不可') +
        ' / jsQR: ' + (typeof window.jsQR === 'function' ? '利用可能' : '読み込み失敗'));
    }

    function handleWorkerDecodeResult(msg) {
      rxWorkerBusy = false;
      if (!stream || receivedDone || (msg.sessionId !== undefined && msg.sessionId !== rxScanSessionId)) {
        return;
      }
      var raw = msg.raw;
      if (raw) {
        scanHits++;
        scanConsecutiveNoQrCount = 0;
        var clean = raw.replace(/^[\r\n]+|[\r\n]+$/g, '');
        if (clean !== scanLastIngestedRawText) {
          scanLastIngestedRawText = clean;
          enqueueIngest(clean);
        }
      } else {
        scanConsecutiveNoQrCount++;
        if (scanConsecutiveNoQrCount >= 5) {
          scanLastIngestedRawText = '';
        }
      }
      scanAttempts++;
      if (stream && !receivedDone) {
        if (scanLatestPresentedFrames !== null &&
            scanLatestPresentedFrames !== scanLastAnalyzedPresentedFrames) {
          triggerScanIfIdle();
        }
      }
    }

    function initQrWorker() {
      if (rxWorker && rxWorkerReady) return Promise.resolve(true);
      if (typeof window === 'undefined' || typeof window.Worker !== 'function') {
        rxWorkerFailed = true;
        return Promise.resolve(false);
      }
      if (rxWorker) {
        try { rxWorker.terminate(); } catch (_) {}
        rxWorker = null;
      }
      return new Promise(function (resolve) {
        try {
          rxWorker = new Worker('data-transfer-worker.js');
          var initTimer = setTimeout(function () {
            rxWorkerFailed = true;
            rxWorkerReady = false;
            resolve(false);
          }, 3000);

          rxWorker.onmessage = function (e) {
            var msg = e.data;
            if (!msg) return;
            if (msg.type === 'init-ready') {
              clearTimeout(initTimer);
              if (msg.success) {
                rxWorkerReady = true;
                rxWorkerFailed = false;
                resolve(true);
              } else {
                rxWorkerFailed = true;
                rxWorkerReady = false;
                resolve(false);
              }
            } else if (msg.type === 'decode-result') {
              handleWorkerDecodeResult(msg);
            }
          };

          rxWorker.onerror = function () {
            clearTimeout(initTimer);
            rxWorkerBusy = false;
            rxWorkerFailed = true;
            rxWorkerReady = false;
            try { rxWorker.terminate(); } catch (_) {}
            rxWorker = null;
            resolve(false);
          };

          rxWorker.postMessage({
            type: 'init',
            scannerType: scannerType
          });
        } catch (_) {
          rxWorkerFailed = true;
          rxWorkerReady = false;
          resolve(false);
        }
      });
    }

    async function startCamera() {
      if (stream) return;
      if (receivedDone) resetRx();
      if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setHeaderBadge('エラー', 'ERROR');
        setStatus('dt-rx-status', 'この環境ではカメラを起動できません。HTTPSまたはlocalhost環境でご利用ください。', 'err');
        return;
      }
      if ($('dt-start-camera')) $('dt-start-camera').disabled = true;
      rxScanSessionId++;
      setHeaderBadge('準備中', 'PREPARING');
      setStatus('dt-rx-status', 'カメラとQR読み取りエンジンを起動しています…', 'info');
      try {
        await initScanner();
        var workerReady = false;
        if (!detector) {
          workerReady = await initQrWorker();
          if (!workerReady) {
            throw new Error('選択したQR読み取りエンジンのWorker初期化に失敗しました');
          }
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30, max: 60 }
          },
          audio: false
        });
        var video = $('dt-camera');
        video.srcObject = stream;
        await video.play();
        if ($('dt-camera-placeholder')) $('dt-camera-placeholder').hidden = true;
        if ($('dt-start-camera')) $('dt-start-camera').disabled = true;
        if ($('dt-stop-camera')) $('dt-stop-camera').disabled = false;
        setHeaderBadge('読み取り中', 'SCANNING');
        setStatus('dt-rx-status',
          'カメラを起動しました。送信側でQRコードの連続表示を開始してください。先頭フレームから自動で受信します。',
          'info');
        scheduleScan(0);
      } catch (error) {
        stopCamera();
        setHeaderBadge('エラー', 'ERROR');
        setStatus('dt-rx-status', 'カメラを起動できませんでした: ' + error.message, 'err');
      }
    }

    function scheduleScan(delay) {
      if (!stream || receivedDone) return;
      var video = $('dt-camera');
      if ((!delay || delay === 0) && video && typeof video.requestVideoFrameCallback === 'function') {
        if (scanVideoFrameCallback !== null) return;
        scanVideoFrameCallback = video.requestVideoFrameCallback(onScanVideoFrame);
        return;
      }
      if (scanTimer) clearTimeout(scanTimer);
      scanTimer = setTimeout(function () {
        scanTimer = 0;
        onScanTimerFallback();
      }, Math.max(0, Number(delay) || 0));
    }

    function onScanVideoFrame(_now, metadata) {
      scanVideoFrameCallback = null;
      if (!stream || receivedDone) return;
      var presented = metadata && Number.isFinite(metadata.presentedFrames)
        ? metadata.presentedFrames
        : null;
      scanLatestPresentedFrames = presented;
      triggerScanIfIdle();
      if (stream && !receivedDone) {
        scheduleScan(0);
      }
    }

    function onScanTimerFallback() {
      if (!stream || receivedDone) return;
      triggerScanIfIdle();
      if (stream && !receivedDone) {
        scheduleScan(16);
      }
    }

    function cancelScanSchedule() {
      if (scanTimer) clearTimeout(scanTimer);
      scanTimer = 0;
      var video = $('dt-camera');
      if (scanVideoFrameCallback !== null && video && typeof video.cancelVideoFrameCallback === 'function') {
        try { video.cancelVideoFrameCallback(scanVideoFrameCallback); } catch (_) {}
      }
      scanVideoFrameCallback = null;
    }

    function stopCamera(reasonMessage) {
      var wasRunning = !!stream;
      cancelScanSchedule();
      rxScanSessionId++;
      if (stream) {
        stream.getTracks().forEach(function (track) {
          try { track.stop(); } catch (_) {}
        });
        stream = null;
      }
      var video = $('dt-camera');
      if (video && video.srcObject) {
        video.srcObject = null;
      }
      if ($('dt-camera-placeholder')) $('dt-camera-placeholder').hidden = false;
      scanBusy = false;
      scanLatestPresentedFrames = null;
      scanLastAnalyzedPresentedFrames = null;
      scanLastIngestedRawText = '';
      scanConsecutiveNoQrCount = 0;
      scanIngestQueue = [];
      scanIngestBusy = false;
      rxWorkerBusy = false;
      if ($('dt-start-camera')) $('dt-start-camera').disabled = false;
      if ($('dt-stop-camera')) $('dt-stop-camera').disabled = true;
      if (!receivedDone && activeSubTab === 'rx') {
        setHeaderBadge('待機中', 'IDLE');
      }
      if (wasRunning && reasonMessage && !receivedDone) {
        setStatus('dt-rx-status', reasonMessage, 'info');
      }
    }

    function triggerScanIfIdle() {
      if (!stream || scanBusy || rxWorkerBusy || receivedDone) return;
      var video = $('dt-camera');
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      if (scanLatestPresentedFrames !== null &&
          scanLatestPresentedFrames === scanLastAnalyzedPresentedFrames) {
        return;
      }
      scanTick();
    }

    function enqueueIngest(rawText) {
      if (scanIngestQueue.length >= MAX_INGEST_QUEUE) {
        scanIngestQueue.shift();
      }
      scanIngestQueue.push(rawText);
      if (!scanIngestBusy) {
        drainIngestQueue();
      }
    }

    async function drainIngestQueue() {
      if (scanIngestBusy || !scanIngestQueue.length || receivedDone) return;
      scanIngestBusy = true;
      try {
        while (scanIngestQueue.length && !receivedDone) {
          var rawText = scanIngestQueue.shift();
          await ingest(rawText);
        }
      } catch (error) {
        setStatus('dt-rx-status', 'データを受信できませんでした: ' + error.message, 'err');
      } finally {
        scanIngestBusy = false;
        if (scanIngestQueue.length && !receivedDone) {
          drainIngestQueue();
        }
      }
    }

    async function detectQrFromCanvasOrVideo(sourceEl, sourceWidth, sourceHeight) {
      if (detector) {
        try {
          var results = await detector.detect(sourceEl);
          var hit = results.find(function (item) { return Wire.isAirgapFrame(item.rawValue); });
          if (hit) return hit.rawValue;
          // Native ran successfully but found no code; do not run a slower decoder too.
          return null;
        } catch (error) {
          // The native API can fail at runtime on a device even after capability probing.
          // In compatibility mode only, fall through to ZXing/jsQR fallback.
          detector = null;
          if ($('dt-rx-allow-fallback') && $('dt-rx-allow-fallback').checked) {
            // Prefer an already initialized ZXing decoder if native BarcodeDetector
            // fails at runtime; only switch to jsQR when ZXing is unavailable.
            if (zxingDecoder && typeof zxingDecoder.readBarcodes === 'function') {
              scannerType = 'zxing-wasm';
              if ($('dt-scanner-mode')) $('dt-scanner-mode').textContent = '読み取り方式: ZXing-C++ WASM（Native実行時フォールバック）';
            } else {
              scannerType = 'jsqr';
              if (!rxWorkerReady) {
                rxWorkerFailed = false;
                var fallbackReady = await initQrWorker();
                if (!fallbackReady) throw new Error('互換モードのjsQR Workerを初期化できませんでした');
              }
              if ($('dt-scanner-mode')) $('dt-scanner-mode').textContent = '読み取り方式: jsQR（Native実行時フォールバック）';
            }
          } else {
            throw error;
          }
        }
      }

      var canvas = $('dt-scan-canvas');
      var scale = Math.min(1, 1280 / Math.max(1, sourceWidth));
      var width = Math.max(1, Math.round(sourceWidth * scale));
      var height = Math.max(1, Math.round(sourceHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        scanCachedContext = null;
      }
      if (!scanCachedContext) {
        scanCachedContext = canvas.getContext('2d', { willReadFrequently: true });
      }
      var context = scanCachedContext;
      context.drawImage(sourceEl, 0, 0, width, height);

      // Center 70% ROI first
      var roiRatio = 0.7;
      var roiW = Math.round(width * roiRatio);
      var roiH = Math.round(height * roiRatio);
      var roiX = Math.round((width - roiW) / 2);
      var roiY = Math.round((height - roiH) / 2);
      var roiImage = context.getImageData(roiX, roiY, roiW, roiH);

      var roiRaw = null;
      if (zxingDecoder) {
        try {
          var roiZxingResults = await zxingDecoder.readBarcodes(roiImage, {
            formats: ['QRCode'],
            maxNumberOfSymbols: 1,
            tryHarder: false
          });
          var roiHit = roiZxingResults.find(function (item) {
            return item && Wire.isAirgapFrame(item.text);
          });
          if (roiHit) roiRaw = roiHit.text;
        } catch (_) {}
      }
      if (!roiRaw && scannerType === 'jsqr' && typeof window.jsQR === 'function') {
        var roiDecoded = window.jsQR(roiImage.data, roiImage.width, roiImage.height, { inversionAttempts: 'dontInvert' });
        if (roiDecoded && Wire.isAirgapFrame(roiDecoded.data)) roiRaw = roiDecoded.data;
      }
      if (roiRaw) return roiRaw;

      // Full-frame pass follows the same selected fallback policy.
      var image = context.getImageData(0, 0, width, height);
      if (zxingDecoder) {
        try {
          var zxingResults = await zxingDecoder.readBarcodes(image, {
            formats: ['QRCode'],
            maxNumberOfSymbols: 1,
            tryHarder: true
          });
          var zxingHit = zxingResults.find(function (item) {
            return item && Wire.isAirgapFrame(item.text);
          });
          if (zxingHit) return zxingHit.text;
        } catch (_) {}
      }
      if (scannerType === 'jsqr' && typeof window.jsQR === 'function') {
        var fullDecoded = window.jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
        if (fullDecoded && Wire.isAirgapFrame(fullDecoded.data)) return fullDecoded.data;
      }
      return null;
    }

    async function scanTick() {
      if (!stream || scanBusy || rxWorkerBusy || receivedDone) return;
      var video = $('dt-camera');
      if (!video || video.readyState < 2 || !video.videoWidth) {
        scheduleScan(30);
        return;
      }

      if (rxWorkerReady && !rxWorkerFailed && !detector) {
        rxWorkerBusy = true;
        scanLastAnalyzedPresentedFrames = scanLatestPresentedFrames;

        var canvas = $('dt-scan-canvas');
        var scale = Math.min(1, 1280 / video.videoWidth);
        var width = Math.max(1, Math.round(video.videoWidth * scale));
        var height = Math.max(1, Math.round(video.videoHeight * scale));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          scanCachedContext = null;
        }
        if (!scanCachedContext) {
          scanCachedContext = canvas.getContext('2d', { willReadFrequently: true });
        }
        scanCachedContext.drawImage(video, 0, 0, width, height);
        var image = scanCachedContext.getImageData(0, 0, width, height);

        try {
          rxWorker.postMessage({
            type: 'decode',
            id: ++rxWorkerRequestId,
            sessionId: rxScanSessionId,
            buffer: image.data.buffer,
            width: width,
            height: height,
            scannerType: scannerType
          }, [image.data.buffer]);
        } catch (_) {
          rxWorkerBusy = false;
          rxWorkerFailed = true;
        }
        return;
      }

      scanBusy = true;
      scanLastAnalyzedPresentedFrames = scanLatestPresentedFrames;
      try {
        var raw = await detectQrFromCanvasOrVideo(video, video.videoWidth, video.videoHeight);
        if (raw) {
          scanHits++;
          scanConsecutiveNoQrCount = 0;
          var clean = raw.replace(/^[\r\n]+|[\r\n]+$/g, '');
          if (clean !== scanLastIngestedRawText) {
            scanLastIngestedRawText = clean;
            enqueueIngest(clean);
          }
        } else {
          scanConsecutiveNoQrCount++;
          if (scanConsecutiveNoQrCount >= 5) {
            scanLastIngestedRawText = '';
          }
        }
      } catch (error) {
        setStatus('dt-rx-status', 'QRコード読み取りエラー: ' + error.message, 'err');
      } finally {
        scanAttempts++;
        scanBusy = false;
        if (stream && !receivedDone) {
          if (scanLatestPresentedFrames !== null &&
              scanLatestPresentedFrames !== scanLastAnalyzedPresentedFrames) {
            triggerScanIfIdle();
          }
        }
      }
    }

    /* ---------- Sub-Tab Switching & Main Tab Lifecycle ---------- */
    function switchSubTab(mode) {
      if (mode !== 'tx' && mode !== 'rx') return;
      activeSubTab = mode;
      var isTx = mode === 'tx';

      if (isTx) {
        // Switching to TX -> ensure RX camera is stopped and released
        if (stream) {
          stopCamera('送信画面に切り替えたため、カメラを停止しました。');
        }
      } else {
        // Switching to RX -> ensure TX QR playback is stopped
        if (txPlaying) {
          stopTx('受信画面に切り替えたため、QRコードの再生を一時停止しました。');
        }
      }

      var btnTx = $('dt-tab-btn-tx');
      var btnRx = $('dt-tab-btn-rx');
      var panelTx = $('dt-panel-tx');
      var panelRx = $('dt-panel-rx');

      if (btnTx) {
        btnTx.classList.toggle('is-active', isTx);
        btnTx.setAttribute('aria-selected', isTx ? 'true' : 'false');
      }
      if (btnRx) {
        btnRx.classList.toggle('is-active', !isTx);
        btnRx.setAttribute('aria-selected', !isTx ? 'true' : 'false');
      }
      if (panelTx) panelTx.hidden = !isTx;
      if (panelRx) panelRx.hidden = isTx;

      if (isTx) {
        updateTxBlockMap();
        if (txPlaying) setHeaderBadge('送信中', 'SENDING');
        else if (txPlan || txFountainEncoder) setHeaderBadge('準備完了', 'READY');
        else setHeaderBadge('待機中', 'IDLE');
      } else {
        updateRxBlockMap();
        if (receivedDone) setHeaderBadge('完了', 'COMPLETED');
        else if (stream) setHeaderBadge('読み取り中', 'SCANNING');
        else setHeaderBadge('待機中', 'IDLE');
      }
    }

    function handleMainTabDeactivated() {
      if (txPlaying) {
        stopTx('別の機能タブへ移動したため、送信を一時停止しました。');
      }
      if (stream) {
        stopCamera('別の機能タブへ移動したため、カメラを停止しました。');
      }
    }

    /* ---------- Event Listeners ---------- */
    if ($('dt-tab-btn-tx')) {
      $('dt-tab-btn-tx').addEventListener('click', function () { switchSubTab('tx'); });
    }
    if ($('dt-tab-btn-rx')) {
      $('dt-tab-btn-rx').addEventListener('click', function () { switchSubTab('rx'); });
    }

    // File selection & Drag-and-Drop
    function updateSelectedFileUi(file) {
      txSelectedFile = file || null;
      var chip = $('dt-tx-file-chip');
      var nameEl = $('dt-tx-file-name');
      var textMeta = $('dt-tx-text-meta');
      if (txSelectedFile) {
        if (nameEl) nameEl.textContent = '📄 ' + txSelectedFile.name + ' (' + formatBytes(txSelectedFile.size) + ')';
        if (chip) chip.hidden = false;
        if (textMeta) textMeta.textContent = '※ファイルが選択されているため、上のファイルが優先して送信されます。';
      } else {
        if (chip) chip.hidden = true;
        updateTextMeta();
      }
    }

    function updateTextMeta() {
      var textMeta = $('dt-tx-text-meta');
      if (!textMeta || txSelectedFile) return;
      var text = valueOf('dt-tx-text', '');
      if (!text) {
        textMeta.textContent = 'ファイル未選択時は、ここに入力したテキストが message.txt として送信されます。';
      } else {
        var byteLen = new TextEncoder().encode(text).length;
        textMeta.textContent = '入力テキスト: ' + text.length.toLocaleString() + ' 文字（' + formatBytes(byteLen) + '）';
      }
    }

    if ($('dt-tx-file')) {
      $('dt-tx-file').addEventListener('change', function () {
        var f = this.files && this.files[0];
        updateSelectedFileUi(f || null);
      });
    }
    if ($('dt-tx-file-clear')) {
      $('dt-tx-file-clear').addEventListener('click', function () {
        if ($('dt-tx-file')) $('dt-tx-file').value = '';
        updateSelectedFileUi(null);
      });
    }
    if ($('dt-tx-dropzone')) {
      var dz = $('dt-tx-dropzone');
      dz.addEventListener('dragover', function (e) {
        e.preventDefault();
        dz.classList.add('is-dragover');
      });
      dz.addEventListener('dragleave', function () {
        dz.classList.remove('is-dragover');
      });
      dz.addEventListener('drop', function (e) {
        e.preventDefault();
        dz.classList.remove('is-dragover');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) updateSelectedFileUi(f);
      });
    }
    if ($('dt-tx-text')) {
      $('dt-tx-text').addEventListener('input', updateTextMeta);
    }

    if ($('dt-chunk-size')) {
      $('dt-chunk-size').addEventListener('input', function () { syncChunkSizeControls('range'); });
    }
    if ($('dt-chunk-size-number')) {
      $('dt-chunk-size-number').addEventListener('input', function () { syncChunkSizeControls('number'); });
    }
    if ($('dt-fps')) {
      $('dt-fps').addEventListener('input', syncFpsControls);
    }
    if ($('dt-rx-allow-fallback')) {
      $('dt-rx-allow-fallback').addEventListener('change', function () {
        storePref('cm-dt-fallback', this.checked ? 'true' : 'false');
      });
    }

    if ($('dt-prepare-tx')) $('dt-prepare-tx').addEventListener('click', prepareTx);
    if ($('dt-play-tx')) $('dt-play-tx').addEventListener('click', playTx);
    if ($('dt-pause-tx')) {
      $('dt-pause-tx').addEventListener('click', function () {
        stopTx('送信を一時停止しました。「送信開始」またはQRコードのタップで再開できます。');
      });
    }
    if ($('dt-reset-tx-head')) {
      $('dt-reset-tx-head').addEventListener('click', function () { resetTxToFirstFrame(); });
    }
    if ($('dt-clear-tx')) {
      $('dt-clear-tx').addEventListener('click', clearTxData);
    }

    if ($('dt-tx-stage')) {
      $('dt-tx-stage').addEventListener('click', function (event) {
        if (event && event.target && event.target.closest &&
            event.target.closest('a,button,input,select,textarea')) return;
        if (!txPlan && !txFountainEncoder) return;
        toggleTxPlayback();
      });
    }

    if ($('dt-tx-blockmap')) {
      $('dt-tx-blockmap').addEventListener('click', function (event) {
        var total = txBlockTotal();
        if (!total) return;
        var canvas = $('dt-tx-blockmap');
        var rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        var x = (event.clientX - rect.left) * canvas.width / rect.width;
        var y = (event.clientY - rect.top) * canvas.height / rect.height;
        var index = blockIndexFromPoint(x, y, canvas.width, canvas.height, total);
        if (index < 0) return;
        canvas.focus();
        txMapSelectedIndex = index;
        seekTxToBlock(index);
      });
      $('dt-tx-blockmap').addEventListener('keydown', function (event) {
        var total = txBlockTotal();
        if (!total) return;
        var columns = Math.min(50, total);
        var next = txMapSelectedIndex;
        if (event.key === 'ArrowLeft') next = Math.max(0, next - 1);
        else if (event.key === 'ArrowRight') next = Math.min(total - 1, next + 1);
        else if (event.key === 'ArrowUp') next = Math.max(0, next - columns);
        else if (event.key === 'ArrowDown') next = Math.min(total - 1, next + columns);
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = total - 1;
        else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          seekTxToBlock(txMapSelectedIndex);
          return;
        } else return;
        event.preventDefault();
        txMapSelectedIndex = next;
        updateTxBlockMap();
      });
      $('dt-tx-blockmap').addEventListener('focus', updateTxBlockMap);
      $('dt-tx-blockmap').addEventListener('blur', updateTxBlockMap);
    }

    if ($('dt-start-camera')) $('dt-start-camera').addEventListener('click', startCamera);
    if ($('dt-stop-camera')) {
      $('dt-stop-camera').addEventListener('click', function () {
        stopCamera('カメラを停止しました。再開するには「カメラを起動」を押してください。');
      });
    }
    if ($('dt-reset-rx')) $('dt-reset-rx').addEventListener('click', resetRx);
    if ($('dt-download-result')) {
      $('dt-download-result').addEventListener('click', triggerDownloadRxFile);
    }
    if ($('dt-copy-result')) {
      $('dt-copy-result').addEventListener('click', copyRxTextResult);
    }
    if ($('dt-rx-again')) {
      $('dt-rx-again').addEventListener('click', function () {
        resetRx();
      });
    }

    // Watch main tab switches so camera & QR playback never stay running in background
    var tabPanel = $('tab-datatransfer');
    if (tabPanel && typeof MutationObserver === 'function') {
      new MutationObserver(function () {
        if (tabPanel.hidden) {
          handleMainTabDeactivated();
        } else {
          updateTxBlockMap();
          updateRxBlockMap();
        }
      }).observe(tabPanel, { attributes: true, attributeFilter: ['hidden'] });
    }
    document.querySelectorAll('.cm-tab').forEach(function (tabBtn) {
      tabBtn.addEventListener('click', function () {
        if (tabBtn.getAttribute('aria-controls') !== 'tab-datatransfer') {
          handleMainTabDeactivated();
        }
      });
    });

    // Watch light/dark theme switches to redraw block-map canvases with theme colors
    if (typeof MutationObserver === 'function' && document.documentElement) {
      new MutationObserver(function () {
        updateTxBlockMap();
        updateRxBlockMap();
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }

    // Visibility & pagehide cleanup
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          if (txPlaying) {
            txPausedByVisibility = true;
            if (txRafId) {
              cancelAnimationFrame(txRafId);
              txRafId = 0;
            }
          }
          if (stream && !receivedDone) {
            cancelScanSchedule();
          }
        } else {
          if (txPlaying && txPausedByVisibility && tabPanel && !tabPanel.hidden) {
            txPausedByVisibility = false;
            txFrameStartTime = performance.now();
            if (!txRafId && !txIsRendering) {
              txRafId = requestAnimationFrame(txAnimationLoop);
            }
          }
          if (stream && !receivedDone && tabPanel && !tabPanel.hidden) {
            scheduleScan(0);
          }
        }
      });
    }

    window.addEventListener('pagehide', function () {
      stopTx();
      stopCamera();
      if (rxWorker) {
        try { rxWorker.terminate(); } catch (_) {}
        rxWorker = null;
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    });

    // Emergency zeroize integration (#btn-zeroize)
    if ($('btn-zeroize')) {
      $('btn-zeroize').addEventListener('click', function () {
        stopCamera();
        clearTxData();
        resetRx();
      });
    }

    // Initialize UI state
    syncChunkSizeControls('range');
    syncFpsControls();
    clearQrCanvas();
    updateTxActionButtons();
    updateTxBlockMap();
    resetRx();

    // Expose controlled API for testing & diagnostics
    window.CryptoMatrixDataTransfer = {
      switchSubTab: switchSubTab,
      prepareTx: prepareTx,
      playTx: playTx,
      stopTx: stopTx,
      clearTxData: clearTxData,
      startCamera: startCamera,
      stopCamera: stopCamera,
      resetRx: resetRx,
      ingest: ingest,
      getState: function () {
        return {
          activeSubTab: activeSubTab,
          txPlaying: txPlaying,
          txPrepared: !!(txPlan || txFountainEncoder),
          txHybridPhase: txHybridPhase,
          txIndex: txIndex,
          txBlockTotal: txBlockTotal(),
          rxCameraActive: !!stream,
          rxReceivedDone: receivedDone,
          rxHaveBlocks: (activeProtocol === 'fountain' || activeProtocol === 'hybrid')
            ? (fountainRx ? fountainRx.simpleParts.size : 0)
            : (rx ? rx.shards.size : 0),
          rxTotalBlocks: (activeProtocol === 'fountain' || activeProtocol === 'hybrid')
            ? (fountainRx ? fountainRx.seqLen : 0)
            : (rx ? rx.total : 0),
          rxFinalFilename: rxFinalFilename,
          rxFinalSize: rxFinalBytes ? rxFinalBytes.length : 0,
          rxFinalText: rxFinalText
        };
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDataTransferApp);
  } else {
    initDataTransferApp();
  }
})();
