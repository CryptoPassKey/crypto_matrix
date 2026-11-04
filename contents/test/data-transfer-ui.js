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

}};const cache={};function req(name){if(cache[name])return cache[name].exports;const m={exports:{}};cache[name]=m;if(!modules[name])throw Error('QR module missing');modules[name](m,m.exports,req);return m.exports;}const QR=req('./index'),level=req('./QRErrorCorrectLevel');window.MatrixQRCode={matrix:function(text){if(!/^[\x00-\x7f]*$/.test(text))throw Error('QR payload must be ASCII');try{const q=new QR(-1,level.M);q.addData(text);q.make();return q.modules;}catch(_){const q=new QR(-1,level.L);q.addData(text);q.make();return q.modules;}},modeFor:function(text){if(!/^[\x00-\x7f]*$/.test(text))throw Error('QR payload must be ASCII');const q=new QR(-1,level.M);q.addData(text);return q.dataList[0].mode;}};})();

/* ===== Data Transfer UI controller ===== */
(function () {
  'use strict';

  // Report startup/runtime failures instead of leaving controls apparently inert.
  window.addEventListener('error', function (event) {
    var message = event && event.message ? event.message : '不明なJavaScriptエラー';
    ['txStatus', 'rxStatus'].forEach(function (id) {
      var element = document.getElementById(id);
      if (element) {
        element.textContent = 'JavaScriptエラー: ' + message;
        element.className = 'status error';
      }
    });
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    var message = reason && reason.message ? reason.message : String(reason || '不明な非同期エラー');
    ['txStatus', 'rxStatus'].forEach(function (id) {
      var element = document.getElementById(id);
      if (element) {
        element.textContent = '非同期処理エラー: ' + message;
        element.className = 'status error';
      }
    });
  });

  var $ = function (id) { return document.getElementById(id); };
  // A page can briefly combine cached HTML and a newer script during SW updates.
  // Read optional controls defensively so a missing stale-DOM node cannot abort startup.
  var valueOf = function (id, fallback) {
    var element = $(id);
    return element && element.value !== undefined ? element.value : fallback;
  };
  var setValue = function (id, value) {
    var element = $(id);
    if (element) element.value = value;
  };
  var Core = window.DataTransferCore;
  var Fountain = window.DataTransferFountain;
  var Wire = window.DataTransferWire;
  var txPlan = null;
  var txFountainEncoder = null;
  var txFountainPart = null;
  var txMode = 'legacy';
  var txHybridPhase = 'legacy';
  var txCurrentBlocks = new Set();
  var txMapSelectedIndex = 0;
  var txIndex = 0;
  var txTimer = 0;
  var txRafId = 0;
  var txFrameStartTime = 0;
  var txIsRendering = false;
  var txPausedByVisibility = false;
  var txPlaying = false;
  var txRenderGeneration = 0;
  // QR matrices are encoded before playback and stored as compact 1-bit data.
  var txQrMatrixCache = [];
  var txFountainQrCache = [];
  var txFountainQrCacheIndex = 1;
  var txQrCacheBytes = 0;
  var TX_QR_CACHE_MAX_BYTES = 64 * 1024 * 1024;
  var txDisplayWindowStart = 0;
  var txDisplayWindowFrames = 0;
  var txLastFrameSwitchAt = 0;
  var rx = new Core.Receiver();
  var fountainRx = new Fountain.Receiver();
  var activeProtocol = null;
  var hybridFountainMeta = null;
  var hybridImportedBlocks = new Set();
  var rxFirstFrameCaptured = false;
  var rxDirectBlocks = new Set();
  var rxCurrentBlocks = new Set();
  var rxCurrentLabel = '';
  var txCurrentLabel = '';
  var stream = null;
  var detector = null;
  var zxingDecoder = null;
  var scannerType = '';
  var scannerPreference = 'auto';
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
  var MAX_INGEST_QUEUE = 16;
  var uniqueFrameCount = 0;
  var scanAttempts = 0;
  var scanHits = 0;
  var scanDecodeTotalMs = 0;
  var scanIngestTotalMs = 0;
  var scanDecodeSamples = [];
  var benchmarkRuns = [];
  var benchmarkRunRecorded = false;
  var rxCameraSettings = null;
  var rxRequestedResolution = null;
  var scanVideoFrameCallback = null;
  var cameraFpsCallback = null;
  var cameraFpsWindowStart = 0;
  var cameraFpsWindowFrames = 0;
  var cameraFpsPreviousPresentedFrames = null;
  var cameraObservedFps = null;
  var txMapLastBlocks = null;
  var txMapLastTotal = -1;
  var txMapLastFocusIndex = null;
  var rxMapDirty = true;
  var scanStartAt = 0;
  var scanFirstHitAt = 0;
  var transferTiming = { startedAt: null, endedAt: null, frameCount: 0 };
  var objectUrl = null;
  var receivedDone = false;
  var rxTransferId = '';
  var autoTestRunning = false;
  var autoTestTimer = 0;
  var autoResetTimer = 0;
  var autoTestResolve = null;
  var autoTestErrorMessage = '';
  var autoTestWasCancelled = false;
  var autoTestPayloadBytes = null;
  var benchmarkPeakHeapBytes = null;
  var benchmarkHeapLimitBytes = null;
  var rxWireByteCount = null;
  var rxOutputByteCount = null;
  var MAX_BENCHMARK_BYTES = 64 * 1024 * 1024;
  var DEFAULT_BENCHMARK_BYTES = 711 * 1024;

  // TX local adaptive FPS: based only on this sender's QR render cost.
  // No RX scan/decode/ingest measurements are read here.
  var txAutoRateController = {
    enabled: false,
    currentFps: Number($('fps') ? valueOf('fps', '10') : 6) || 6,
    minFps: 3,
    maxFps: 120,
    windowStartedAt: 0,
    renderSamples: [],
    statusText: '待機中',
    clearWindow: function () {
      this.windowStartedAt = performance.now();
      this.renderSamples = [];
    },
    reset: function () {
      this.currentFps = Number($('fps') ? valueOf('fps', '10') : 6) || 6;
      this.minFps = Math.max(1, Number($('minFps') ? valueOf('minFps', '3') : 3) || 3);
      this.maxFps = Math.max(this.minFps, Math.min(120, Number($('maxFps') ? valueOf('maxFps', '24') : 24) || 24));
      this.statusText = this.enabled ? 'TXローカル性能を観測中' : '固定FPS';
      this.clearWindow();
      this.updateUi();
    },
    recordRender: function (renderMs) {
      if (!this.enabled || !Number.isFinite(renderMs) || renderMs < 0) return;
      this.renderSamples.push(renderMs);
      if (this.renderSamples.length > 32) this.renderSamples.shift();
      var now = performance.now();
      if (now - this.windowStartedAt < 1200 || this.renderSamples.length < 4) return;
      var sorted = this.renderSamples.slice().sort(function(a,b){return a-b;});
      var p95 = sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.95))];
      var interval = 1000 / Math.max(1, this.currentFps);
      if (p95 > interval * 0.75) {
        this.currentFps = Math.max(this.minFps, this.currentFps - 1);
        this.statusText = 'QR生成負荷により減速 (P95 ' + p95.toFixed(1) + ' ms)';
      } else if (p95 < interval * 0.30) {
        this.currentFps = Math.min(this.maxFps, this.currentFps + 1);
        this.statusText = '送信端末の描画余力により増速 (P95 ' + p95.toFixed(1) + ' ms)';
      } else {
        this.statusText = 'TX描画性能に合わせて維持 (P95 ' + p95.toFixed(1) + ' ms)';
      }
      this.windowStartedAt = now;
      this.renderSamples = [];
      this.updateUi();
    },
    updateUi: function () {
      var out = $('fpsValue');
      if (out) out.textContent = this.enabled
        ? this.currentFps + ' 枚/秒'
        : ($('fps') ? valueOf('fps', '10') : 6) + ' 枚/秒';
      var badge = $('autoFpsStatus');
      if (badge) badge.textContent = this.statusText;
    }
  };

  // 優先6: 送信速度の適応制御（受信成功率・遅延・復元効率を優先した自動速度調整）
  var rxRateAdvisor = {
    enabled: false,
    minFps: 3,
    maxFps: 24,
    currentFps: 6,
    windowMs: 1200,
    lastEvalTime: 0,
    cooldownUntil: 0,
    statusText: '待機中',
    recommendationText: '—',

    // 観測ウィンドウ積算値
    windowAttempts: 0,
    windowHits: 0,
    windowDuplicates: 0,
    windowNovel: 0,
    windowSamples: [],
    windowQueueSum: 0,
    windowQueueCount: 0,
    windowStartDecoded: 0,
    windowRedundantFountain: 0,
    windowUsefulFountain: 0,

    reset: function () {
      var manualFps = Number($('fps') ? valueOf('fps', '10') : 6) || 6;
      this.currentFps = manualFps;
      this.lastEvalTime = performance.now();
      this.cooldownUntil = 0;
      this.statusText = this.enabled ? '観測中 (' + this.currentFps + ' fps)' : 'OFF (固定 ' + manualFps + ' fps)';
      this.recommendationText = '—';
      this.clearWindow();
      this.updateUi();
    },

    clearWindow: function () {
      this.windowAttempts = 0;
      this.windowHits = 0;
      this.windowDuplicates = 0;
      this.windowNovel = 0;
      this.windowSamples = [];
      this.windowQueueSum = 0;
      this.windowQueueCount = 0;
      var curDecoded = (activeProtocol === 'fountain' || activeProtocol === 'hybrid')
        ? (fountainRx ? fountainRx.simpleParts.size : 0)
        : (rx ? rx.shards.size : 0);
      this.windowStartDecoded = curDecoded;
      this.windowRedundantFountain = 0;
      this.windowUsefulFountain = 0;
    },

    recordScanAttempt: function (hit, isNovel, decodeMs) {
      this.windowAttempts++;
      if (hit) {
        this.windowHits++;
        if (isNovel) this.windowNovel++;
        else this.windowDuplicates++;
        if (typeof decodeMs === 'number' && Number.isFinite(decodeMs)) {
          this.windowSamples.push(decodeMs);
        }
      }
    },

    recordQueueLength: function (queueLen) {
      this.windowQueueSum += queueLen;
      this.windowQueueCount++;
    },

    recordIngestResult: function (isDuplicate, isComplete) {
      if (isDuplicate) this.windowRedundantFountain++;
      else this.windowUsefulFountain++;
    },

    evaluate: function (now) {
      if (receivedDone) return;
      var elapsed = now - this.lastEvalTime;
      if (elapsed < this.windowMs) return;

      var attempts = this.windowAttempts;
      var hits = this.windowHits;
      var novel = this.windowNovel;
      var duplicates = this.windowDuplicates;
      var samples = this.windowSamples;
      var curDecoded = (activeProtocol === 'fountain' || activeProtocol === 'hybrid')
        ? (fountainRx ? fountainRx.simpleParts.size : 0)
        : (rx ? rx.shards.size : 0);
      var progressDelta = curDecoded - this.windowStartDecoded;
      var avgQueue = this.windowQueueCount > 0 ? (this.windowQueueSum / this.windowQueueCount) : 0;
      var currentQueue = scanIngestQueue ? scanIngestQueue.length : 0;

      this.lastEvalTime = now;

      // ユーザー設定上限・下限の反映
      var minVal = Number($('minFps') ? valueOf('minFps', '3') : 3) || 3;
      var maxVal = Number($('maxFps') ? valueOf('maxFps', '24') : 24) || 24;
      if (minVal > maxVal) { var tmp = minVal; minVal = maxVal; maxVal = tmp; }
      this.minFps = Math.max(1, minVal);
      this.maxFps = Math.min(120, maxVal);

      // サンプル数が少なすぎる場合は判定保留
      if (attempts < 3) {
        this.clearWindow();
        return;
      }

      var hitRate = hits / attempts;
      var duplicateRate = hits > 0 ? (duplicates / hits) : 0;
      var p50Ms = percentileValue(samples, 0.50) || 0;
      var p95Ms = percentileValue(samples, 0.95) || 0;
      var currentInterval = 1000 / Math.max(1, this.currentFps);

      // 推奨値と状況表示の更新
      this.recommendationText = '実測: ' + (hits * 1000 / elapsed).toFixed(1) + ' fps · 検出率: ' +
        (hitRate * 100).toFixed(0) + '%' + ' · P95: ' + p95Ms.toFixed(1) + 'ms · 重複率: ' +
        (duplicateRate * 100).toFixed(0) + '%' +
        (progressDelta > 0 ? ' · 復元進捗: +' + progressDelta + '片' : ' · 復元進捗: 停滞');
      var recEl = $('rxSpeedRecommendation');
      if (recEl) recEl.textContent = this.recommendationText;

      // 自動調整が無効な場合は推奨表示のみ更新してリターン
      if (!this.enabled) {
        this.statusText = 'OFF (固定 ' + ($('fps') ? valueOf('fps', '10') : 6) + ' fps)';
        this.clearWindow();
        this.updateUi();
        return;
      }

      // クールダウン（速度変更直後の安定待ち）期間の確認
      if (now < this.cooldownUntil) {
        this.statusText = '変更後安定確認中 (' + this.currentFps + ' fps)';
        this.clearWindow();
        this.updateUi();
        return;
      }

      var nextFps = this.currentFps;
      var reason = '';

      // === 判定ルール（受信成功率と実効復元スループット最優先） ===
      // 1. キュー滞留・処理追いつき不能（即時減速）
      if (currentQueue >= 4 || avgQueue >= 3) {
        nextFps = Math.max(this.minFps, this.currentFps - 2);
        reason = '受信キュー滞留 (' + currentQueue + '件) による減速';
      }
      // 2. デコード時間P95/P50の飽和（CPU/Worker過負荷、即時減速）
      else if (p95Ms > currentInterval * 0.85 || p50Ms > currentInterval * 0.70) {
        var backoff = Math.max(1, Math.round(this.currentFps * 0.2));
        nextFps = Math.max(this.minFps, this.currentFps - backoff);
        reason = '解析遅延増加 (P95: ' + p95Ms.toFixed(1) + 'ms / 目標間隔: ' + currentInterval.toFixed(1) + 'ms) による減速';
      }
      // 3. QR検出率の低下（露出・ブレ・コマ落ち、速度抑制）
      else if (hitRate < 0.65) {
        nextFps = Math.max(this.minFps, this.currentFps - 1);
        reason = '検出率低下 (' + (hitRate * 100).toFixed(0) + '%) による減速';
      }
      // 4. 重複過多および復元停滞（無駄なパケット空転、減速して確実なパケット取得へ）
      else if (hits >= 6 && progressDelta <= 0 && duplicateRate > 0.75) {
        if (this.currentFps > this.minFps) {
          nextFps = Math.max(this.minFps, this.currentFps - 1);
          reason = '復元進捗停滞・重複過多 (' + (duplicateRate * 100).toFixed(0) + '%) による減速';
        } else {
          reason = '重複率高 (' + (duplicateRate * 100).toFixed(0) + '%)・下限 (' + this.minFps + ' fps) 維持';
        }
      }
      // 5. 安定・検出率高・余力十分・復元進捗あり（+1 fps 漸増）
      else if (hitRate >= 0.85 && p95Ms < currentInterval * 0.55 && currentQueue <= 1 && (progressDelta > 0 || duplicateRate < 0.50)) {
        if (this.currentFps < this.maxFps) {
          nextFps = Math.min(this.maxFps, this.currentFps + 1);
          reason = '受信安定・検出率 ' + (hitRate * 100).toFixed(0) + '%・余力あり: 速度向上 (+1 fps)';
        } else {
          reason = '上限到達 (' + this.maxFps + ' fps) で安定継続';
        }
      }
      // 6. 均衡状態（維持）
      else {
        reason = '最適速度で安定中 (' + this.currentFps + ' fps · 検出率: ' + (hitRate * 100).toFixed(0) + '%)';
      }

      // 速度変更の適用
      if (nextFps !== this.currentFps) {
        this.currentFps = nextFps;
        this.cooldownUntil = now + this.windowMs * 1.2;
      }

      this.statusText = reason;
      this.clearWindow();
      this.updateUi();
    },

    updateUi: function () {
      var badge = $('autoFpsStatus');
      if (badge) badge.textContent = this.statusText;
      // RX advisor is display-only. It must never update TX controls.
      var rxStatus = $('rxSpeedRecommendation');
      if (rxStatus) rxStatus.textContent = this.recommendationText + ' · ' + this.statusText;
    }
  };

  function status(id, message, kind) {
    var el = $(id);
    el.textContent = message;
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + ' KiB';
    return (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1) + ' MiB';
  }

  function selectedBenchmarkBytes() {
    var value = Number(valueOf('benchmarkSizeInput', '1048576'));
    if (!Number.isFinite(value) || value < 1024) value = DEFAULT_BENCHMARK_BYTES;
    return Math.max(1024, Math.min(MAX_BENCHMARK_BYTES, Math.round(value / 1024) * 1024));
  }

  function updateBenchmarkSizeControls(source) {
    var bytes = source === 'range' ? Number(valueOf('benchmarkSizeRange', '1048576')) : Number(valueOf('benchmarkSizeInput', '1048576'));
    if (!Number.isFinite(bytes) || bytes < 1024) bytes = DEFAULT_BENCHMARK_BYTES;
    bytes = Math.max(1024, Math.min(MAX_BENCHMARK_BYTES, Math.round(bytes / 1024) * 1024));
    setValue('benchmarkSizeRange', String(bytes));
    setValue('benchmarkSizeInput', String(bytes));
    if ($('benchmarkSizeValue')) $('benchmarkSizeValue').textContent = formatBytes(bytes) + ' · ' + bytes.toLocaleString() + ' B';
  }

  function createBenchmarkPayload(length) {
    if (!Number.isSafeInteger(length) || length < 1 || length > MAX_BENCHMARK_BYTES) {
      throw new RangeError('テストデータ量は1 KiB～64 MiBで指定してください');
    }
    var bytes = new Uint8Array(length);
    var state = 0x9e3779b9;
    for (var i = 0; i < bytes.length; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      bytes[i] = state & 0xff;
    }
    return bytes;
  }

  function sampleBenchmarkMemory() {
    var memory = typeof performance !== 'undefined' ? performance.memory : null;
    if (!memory || !Number.isFinite(memory.usedJSHeapSize)) return;
    benchmarkPeakHeapBytes = Math.max(benchmarkPeakHeapBytes || 0, memory.usedJSHeapSize);
    if (Number.isFinite(memory.jsHeapSizeLimit)) benchmarkHeapLimitBytes = memory.jsHeapSizeLimit;
  }

  function formatRate(bytes, elapsedMs) {
    if (!Number.isFinite(bytes) || bytes < 0 || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return '—';
    var kibPerSecond = bytes * 1000 / elapsedMs / 1024;
    return kibPerSecond.toFixed(2) + ' KB/s';
  }

  function sameSet(left, right) {
    if (!left || !right || left.size !== right.size) return false;
    for (var value of left) if (!right.has(value)) return false;
    return true;
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

  function formatElapsedMs(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
    var totalSeconds = Math.floor(milliseconds / 1000);
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    var mm = String(minutes).padStart(2, '0');
    var ss = String(seconds).padStart(2, '0');
    return hours
      ? String(hours).padStart(2, '0') + ':' + mm + ':' + ss
      : mm + ':' + ss;
  }

  function percentileValue(samples, percentile) {
    if (!Array.isArray(samples) || samples.length === 0) return null;
    var sorted = samples.filter(Number.isFinite).slice().sort(function (a, b) { return a - b; });
    if (!sorted.length) return null;
    var p = Math.min(1, Math.max(0, Number(percentile) || 0));
    var position = (sorted.length - 1) * p;
    var lower = Math.floor(position);
    var upper = Math.ceil(position);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  }

  function nextLegacyFrameIndexAfterPreflight(frameCount) {
    return Number.isSafeInteger(frameCount) && frameCount > 1 ? 1 : 0;
  }

  function syncChunkSizeControls(source) {
    var range = $('chunkSize');
    var number = $('chunkSizeNumber');
    if (!range || !number) return;
    var maximum = valueOf('wireFormat', 'base45') === 'base64url' ? 2100 : 2800;
    range.max = String(maximum);
    number.max = String(maximum);
    var requested = Number(source === 'number' ? number.value : range.value);
    if (!Number.isFinite(requested)) requested = 180;
    var value = Math.max(80, Math.min(maximum, Math.round(requested / 20) * 20));
    range.value = String(value);
    number.value = String(value);
    $('chunkSizeValue').textContent = value + ' B';
  }

  function updateControls() {
    syncChunkSizeControls('range');
    $('fpsValue').textContent = txAutoRateController.enabled
      ? txAutoRateController.currentFps + ' 枚/秒'
      : valueOf('fps', '10') + ' 枚/秒';
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
      if (!Number.isSafeInteger(packet.group) || packet.group < 0 || packet.group * 8 >= packet.total) {
        throw new Error('パリティグループ番号が不正です');
      }
      var start = packet.group * 8;
      var count = Math.min(8, packet.total - start);
      return Array.from({ length: count }, function (_, offset) { return start + offset; });
    }
    throw new Error('未対応のQRフレーム種別です');
  }

  function drawBlockMap(canvasId, total, directSet, recoveredSet, activeSet, activeFill, focusIndex) {
    var canvas = $(canvasId);
    if (!canvas) return;
    total = Math.max(0, Number(total) || 0);

    var columns = total ? Math.min(50, total) : 50;
    var rows = Math.max(1, Math.ceil(total / columns));

    var cell = Math.max(3, Math.min(12, Math.floor(4096 / rows)));
    canvas.width = columns * cell;
    canvas.height = rows * cell;
    var context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#17283a';
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!total) return;
    for (var index = 0; index < total; index++) {
      var color = '#405a75';
      if (directSet && directSet.has(index)) color = '#20d69a';
      if (recoveredSet && recoveredSet.has(index)) color = '#ffc247';
      if (activeFill && activeSet && activeSet.has(index)) color = '#00e5ff';
      var x = (index % columns) * cell;
      var y = Math.floor(index / columns) * cell;
      context.fillStyle = color;
      context.fillRect(x, y, cell - 1, cell - 1);
      if (activeSet && activeSet.has(index)) {

        if (cell >= 4) {
          context.strokeStyle = '#ffffff';
          context.lineWidth = 2.5;
          context.strokeRect(x + 0.5, y + 0.5, cell - 2, cell - 2);
        }
        context.strokeStyle = '#07111d';
        context.lineWidth = cell >= 4 ? 2 : 1;
        context.strokeRect(x + 1, y + 1, Math.max(0, cell - 3), Math.max(0, cell - 3));
      }
      if (focusIndex === index) {
        context.save();
        context.setLineDash([2, 1]);
        context.strokeStyle = '#ffd166';
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
    var canvas = $('txBlockMap');
    var total = txBlockTotal();
    if (total) {
      txMapSelectedIndex = Math.max(0, Math.min(total - 1, txMapSelectedIndex));
      canvas.tabIndex = 0;
      canvas.setAttribute('aria-disabled', 'false');
      canvas.setAttribute('aria-valuemax', String(total));
      canvas.setAttribute('aria-valuenow', String(txMapSelectedIndex + 1));
      canvas.setAttribute('aria-valuetext', 'ブロック ' + (txMapSelectedIndex + 1) + ' を選択');
      var focusIndex = document.activeElement === canvas ? txMapSelectedIndex : -1;
      if (total !== txMapLastTotal || !sameSet(txCurrentBlocks, txMapLastBlocks) ||
          focusIndex !== txMapLastFocusIndex) {
        drawBlockMap('txBlockMap', total, null, null, txCurrentBlocks, true, focusIndex);
        txMapLastBlocks = new Set(txCurrentBlocks);
        txMapLastTotal = total;
        txMapLastFocusIndex = focusIndex;
      }
      $('txBlockSummary').textContent = '現在の送信位置を表示しています';
    } else {
      canvas.tabIndex = -1;
      canvas.setAttribute('aria-disabled', 'true');
      canvas.setAttribute('aria-valuemax', '1');
      canvas.setAttribute('aria-valuenow', '1');
      canvas.setAttribute('aria-valuetext', '転送データなし');
      if (txMapLastTotal !== 0) {
        drawBlockMap('txBlockMap', 0, null, null, null, false, -1);
        txMapLastBlocks = new Set();
        txMapLastTotal = 0;
        txMapLastFocusIndex = -1;
      }
      $('txBlockSummary').textContent = '転送データを準備すると送信位置が表示されます';
    }
  }

  function blockIndexFromPoint(x, y, canvasWidth, canvasHeight, total) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || total < 1 || canvasWidth < 1 || canvasHeight < 1 ||
        x < 0 || y < 0 || x >= canvasWidth || y >= canvasHeight) return -1;
    var columns = Math.min(50, total);
    var rows = Math.max(1, Math.ceil(total / columns));
    var cell = Math.max(1, Math.min(8, Math.floor(4096 / rows)));
    var column = Math.floor(x / cell);
    var row = Math.floor(y / cell);
    if (column >= columns || row >= rows) return -1;
    var index = row * columns + column;
    return index < total ? index : -1;
  }

  function legacyFrameIndexForBlock(blockIndex, plan) {
    if (!plan || !Number.isSafeInteger(blockIndex) || blockIndex < 0 || blockIndex >= plan.dataFrames.length) return -1;
    var groupSize = plan.groupSize || 8;
    var groupsBefore = Math.floor(blockIndex / groupSize);
    return blockIndex + (plan.parityFrames ? groupsBefore * 2 : 0);
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
      var hybridMode = txMode === 'hybrid' || txMode === 'hybrid-data';
      if (hybridMode && txPlan) {
        // どの周回・LT修復中でも、対象ブロックの1周目Dataフレームから再開
        txHybridPhase = 'legacy';
        var frameIndex = legacyFrameIndexForBlock(blockIndex, txPlan);
        if (frameIndex < 0 || frameIndex >= txPlan.frames.length) throw new Error('指定ブロックのフレーム位置が見つかりません');
        var packet = Core.parseFrame(txPlan.frames[frameIndex]);
        if (packet.type !== 'data' || packet.index !== blockIndex) throw new Error('指定ブロックとDataフレームの位置が一致しません');
        txIndex = frameIndex;
      } else if (txMode === 'fountain' && txFountainEncoder) {
        if (typeof txFountainEncoder.seekToBlock !== 'function') {
          throw new Error('Fountain EncoderとUIのAPI版が一致しません。ページを再読み込みしてください');
        }
        txFountainEncoder.seekToBlock(blockIndex);
        // Random access invalidates the precomputed Fountain sequence; continue from the seek point.
        txFountainQrCacheIndex = txFountainQrCache.length;
      } else if (txPlan) {
        var frameIndex = legacyFrameIndexForBlock(blockIndex, txPlan);
        if (frameIndex < 0 || frameIndex >= txPlan.frames.length) throw new Error('指定ブロックのフレーム位置が見つかりません');
        var packet = Core.parseFrame(txPlan.frames[frameIndex]);
        if (packet.type !== 'data' || packet.index !== blockIndex) throw new Error('指定ブロックとDataフレームの位置が一致しません');
        txIndex = frameIndex;
      }
      txMapSelectedIndex = blockIndex;
      txPlaying = true;
      $('playTx').disabled = true;
      $('pauseTx').disabled = false;
      updateTxPlayBadge();
      status('txStatus', 'ブロック ' + (blockIndex + 1) + ' から再生を開始しました。', 'info');
      showNextFrame();
    } catch (error) {
      status('txStatus', '再生位置の変更に失敗しました: ' + error.message, 'error');
    }
  }

  function onTxBlockMapClick(event) {
    var total = txBlockTotal();
    if (!total) return;
    var canvas = $('txBlockMap');
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var x = (event.clientX - rect.left) * canvas.width / rect.width;
    var y = (event.clientY - rect.top) * canvas.height / rect.height;
    var index = blockIndexFromPoint(x, y, canvas.width, canvas.height, total);
    if (index < 0) return;
    canvas.focus();
    txMapSelectedIndex = index;
    seekTxToBlock(index);
  }

  function onTxBlockMapKeyDown(event) {
    var total = txBlockTotal();
    if (!total) return;
    var columns = Math.min(75, total);
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
  }

  function updateModeControls() {
    $('txModeHint').textContent = 'QRコードを受信側のカメラに向けてください。読み取り確認後、送信を開始します。';
    $('txFrameCountLabel').textContent = '送信状態';
  }

  $('chunkSize').addEventListener('input', function () {
    syncChunkSizeControls('range');
    updateControls();
  });
  $('chunkSizeNumber').addEventListener('input', function () {
    syncChunkSizeControls('number');
    updateControls();
  });
  $('wireFormat').addEventListener('change', function () {
    syncChunkSizeControls('range');
    updateControls();
  });
  $('fps').addEventListener('input', function () {
    txAutoRateController.currentFps = Number(this.value) || 6;
    txAutoRateController.clearWindow();
    updateControls();
  });
  if ($('autoFpsEnabled')) {
    $('autoFpsEnabled').addEventListener('change', function () {
      txAutoRateController.enabled = this.checked;
      rxRateAdvisor.enabled = this.checked;
      if ($('autoFpsControls')) {
        $('autoFpsControls').style.display = this.checked ? 'block' : 'none';
      }
      txAutoRateController.reset();
      rxRateAdvisor.reset();
      updateControls();
    });
  }
  if ($('minFps')) {
    $('minFps').addEventListener('change', function () {
      txAutoRateController.minFps = Math.max(1, Math.min(120, Number(this.value) || 3));
      rxRateAdvisor.minFps = txAutoRateController.minFps;
      txAutoRateController.reset();
      rxRateAdvisor.reset();
    });
  }
  if ($('maxFps')) {
    $('maxFps').addEventListener('change', function () {
      txAutoRateController.maxFps = Math.max(1, Math.min(120, Number(this.value) || 24));
      rxRateAdvisor.maxFps = txAutoRateController.maxFps;
      txAutoRateController.reset();
      rxRateAdvisor.reset();
    });
  }
  $('txBlockMap').addEventListener('click', onTxBlockMapClick);
  $('txBlockMap').addEventListener('keydown', onTxBlockMapKeyDown);
  $('txBlockMap').addEventListener('focus', updateTxBlockMap);
  $('txBlockMap').addEventListener('blur', updateTxBlockMap);
  updateControls();

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
    if (!window.MatrixQRCode) throw new Error('MatrixQRCode が読み込まれていません');
    return packQrMatrix(MatrixQRCode.matrix(text));
  }

  async function createQrCacheEntry(text, scratchCanvas) {
    if (!window.MatrixQRCode) throw new Error('MatrixQRCode が読み込まれていません');
    var matrix = MatrixQRCode.matrix(text);
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
      } catch (_) {
        // Packed-matrix fallback remains available on browsers without a usable bitmap path.
      }
    }
    return packQrMatrix(matrix);
  }

  function disposeQrCache(entries) {
    if (!entries) return;
    for (var i = 0; i < entries.length; i++) {
      var qr = entries[i] && entries[i].qr;
      if (qr && qr.bitmap && typeof qr.bitmap.close === 'function') qr.bitmap.close();
    }
  }

  function renderQrMatrix(entry) {
    if (!entry) throw new Error('事前生成QRキャッシュがありません');
    var canvas = $('txCanvas');
    var context = canvas.getContext('2d', { alpha: false });
    var size = canvas.width;
    context.fillStyle = '#fff';
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
    context.fillStyle = '#000';
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

  async function prepareTxQrCache() {
    disposeQrCache(txQrMatrixCache);
    disposeQrCache(txFountainQrCache);
    txQrMatrixCache = [];
    txFountainQrCache = [];
    txFountainQrCacheIndex = 1;
    txQrCacheBytes = 0;
    var fountainMode = txMode === 'fountain';
    var total = fountainMode
      ? (txFountainEncoder ? txFountainEncoder.seqLen : 0)
      : (txPlan ? txPlan.frames.length : 0);
    var cache = [];
    var currentPart = txFountainPart;
    var scratchCanvas = document.createElement('canvas');
    var startedAt = performance.now();

    for (var i = 0; i < total; i++) {
      var frame;
      if (fountainMode) {
        if (i > 0) currentPart = await txFountainEncoder.nextPart();
        frame = currentPart.frame;
      } else {
        frame = txPlan.frames[i];
      }

      var qr = await createQrCacheEntry(frame, scratchCanvas);
      var entryBytes = qr.bytes || (qr.packed.byteLength + 16);
      var cacheLimitReached = cache.length > 0 &&
        txQrCacheBytes + entryBytes > TX_QR_CACHE_MAX_BYTES;
      // Keep the frame already requested from the Fountain encoder; otherwise
      // stopping at the memory limit would silently skip that sequence number.
      cache.push({ frame: frame, qr: qr, part: fountainMode ? currentPart : null });
      txQrCacheBytes += entryBytes;
      if (cacheLimitReached) break;

      if ((i + 1) % 16 === 0) {
        $('txCacheStatus').textContent =
          'QR事前生成: ' + cache.length + ' / ' + total + ' 枚 · ' +
          formatBytes(txQrCacheBytes);
        status('txStatus', 'QRコードを事前生成しています: ' + cache.length + ' / ' + total, 'info');
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
      }
    }

    if (fountainMode) {
      txFountainQrCache = cache;
      // Entry 0 is already displayed as the preflight QR.
      txFountainQrCacheIndex = 1;
    } else {
      txQrMatrixCache = cache;
    }

    var elapsed = performance.now() - startedAt;
    $('txCacheStatus').textContent =
      'QR事前生成: ' + cache.length + ' / ' + total + ' 枚 · ' +
      formatBytes(txQrCacheBytes) +
      (cache.length < total ? '（メモリ上限のため残りは再生時生成）' : '（全件完了）');
    $('txQrGenMs').textContent = elapsed.toFixed(1) + ' ms';
    return { cachedFrames: cache.length, totalFrames: total, durationMs: elapsed };
  }

  function recordTxDisplayFrame(now) {
    if (!txDisplayWindowStart) {
      txDisplayWindowStart = now;
      txLastFrameSwitchAt = now;
      txDisplayWindowFrames = 0;
      return;
    }
    txDisplayWindowFrames++;
    txLastFrameSwitchAt = now;
    var elapsed = now - txDisplayWindowStart;
    if (elapsed >= 1000) {
      $('txDisplayFps').textContent = (txDisplayWindowFrames * 1000 / elapsed).toFixed(1);
      txDisplayWindowStart = now;
      txDisplayWindowFrames = 0;
    }
  }

  async function prepareTx() {
    stopTx();
    $('prepareTx').disabled = true;
    try {
      var file = $('txFile').files && $('txFile').files[0];
      var sourceBytes;
      var sourceName;
      if (file) {
        if (file.size > MAX_BENCHMARK_BYTES) throw new Error('最大転送サイズは64 MiBです');
        sourceBytes = new Uint8Array(await file.arrayBuffer());
        sourceName = file.name;
      } else {
        var text = valueOf('txText', '');
        if (!text) throw new Error('転送するファイルまたはテキストを指定してください');
        sourceBytes = new TextEncoder().encode(text);
        sourceName = 'message.txt';
      }
      if (sourceBytes.length > MAX_BENCHMARK_BYTES) throw new Error('試験ページの上限は64 MiBです');

      var namedPayload = packNamedPayload(sourceBytes, sourceName);
      if (namedPayload.length > MAX_BENCHMARK_BYTES) {
        throw new Error('ファイル名メタデータを含む転送データが64 MiBを超えています');
      }
      var wireBytes = namedPayload;
      var compressionNote = '圧縮なし';
      if ($('compressionEnabled').checked) {
        var packed = await Core.compressIfSmaller(namedPayload);
        wireBytes = packed.bytes;
        compressionNote = packed.compressed
          ? 'Deflate: ' + formatBytes(sourceBytes.length) + ' → ' + formatBytes(wireBytes.length)
          : 'Deflate省略: ' + packed.reason;
      }

      txMode = valueOf('transferMode', 'hybrid-data');
      var chunkBytes = Number(valueOf('chunkSize', '800'));
      if (Math.ceil(wireBytes.length / chunkBytes) > 100000) {
        throw new Error('このデータ量ではデータ片数が100,000片を超えます。チャンクサイズを大きくしてください');
      }
      var hybridMode = txMode === 'hybrid' || txMode === 'hybrid-data';
      var wireFormat = valueOf('wireFormat', 'base45') === 'base64url' ? 'base64url' : 'base45';
      txHybridPhase = 'legacy';
      txPlan = null;
      txFountainEncoder = null;
      txFountainPart = null;
      txCurrentBlocks.clear();
      txMapSelectedIndex = 0;
      txIndex = 0;

      var firstFrame;
      var transferId;
      var blockCount;
      var frameLabel;
      if (txMode === 'fountain') {
        txFountainEncoder = new Fountain.Encoder(wireBytes, {
          chunkSize: Number(valueOf('chunkSize', '800')),
          wireFormat: wireFormat
        });
        if (typeof txFountainEncoder.seekToBlock !== 'function') {
          throw new Error('Fountain Encoder APIが不完全です。V5のFountainモジュールを確認してください');
        }
        txFountainPart = await txFountainEncoder.nextPart();
        firstFrame = txFountainPart.frame;
        transferId = txFountainEncoder.id;
        blockCount = txFountainEncoder.seqLen;
        txCurrentBlocks = new Set(txFountainPart.indexes);
        txCurrentLabel = 'LT seq 1 · Data · 対象 1';
        $('txFrameCount').textContent = '準備完了';
        frameLabel = '先頭QRコード · 受信側で読み取り待ち';
      } else {
        var parityEnabled = txMode === 'hybrid' ? true
          : (txMode === 'legacy-data' || txMode === 'hybrid-data' ? false : $('parityEnabled').checked);
        txPlan = Core.buildFrames(wireBytes, {
          chunkSize: Number(valueOf('chunkSize', '800')),
          parity: parityEnabled,
          wireFormat: wireFormat
        });
        firstFrame = txPlan.frames[0];
        transferId = txPlan.id;
        blockCount = txPlan.dataFrames.length;
        var firstPacket = Core.parseFrame(firstFrame);
        txCurrentBlocks = new Set(packetBlockIndexes(firstPacket));
        if (firstPacket.type === 'data') {
          txCurrentLabel = 'Data ' + (firstPacket.index + 1) + ' / ' + firstPacket.total;
        } else {
          txCurrentLabel = 'P' + firstPacket.parityType + ' · group ' +
            (firstPacket.group + 1) + ' · block ' +
            (firstPacket.group * Core.GROUP_SIZE + 1) + '–' +
            Math.min(firstPacket.total, (firstPacket.group + 1) * Core.GROUP_SIZE);
        }
        if (hybridMode) {
          txFountainEncoder = new Fountain.Encoder(wireBytes, {
            chunkSize: Number(valueOf('chunkSize', '800')),
            id: txPlan.id,
            wireFormat: wireFormat
          });
          if (txFountainEncoder.seqLen !== blockCount ||
              txFountainEncoder.fragmentLen !== txPlan.chunkSize) {
            throw new Error('HybridのDataブロックとLTブロック境界が一致しません');
          }
          if (typeof txFountainEncoder.seekToBlock !== 'function') {
            throw new Error('Fountain Encoder APIが不完全です。V5のFountainモジュールを確認してください');
          }
          txFountainEncoder.startRepairPhase();
          txHybridPhase = 'legacy';
          txIndex = 1;
          $('txFrameCount').textContent = '準備完了';
          frameLabel = '先頭QRコード · 受信側で読み取り待ち';
        } else {
          txIndex = nextLegacyFrameIndexAfterPreflight(txPlan.frames.length);
          $('txFrameCount').textContent = '準備完了';
          frameLabel = '先頭QRコード · 受信側で読み取り待ち';
        }
      }
      var cacheResult = await prepareTxQrCache();
      var planStart = performance.now();
      var firstCacheEntry = txMode === 'fountain' ? txFountainQrCache[0] : txQrMatrixCache[0];
      if (firstCacheEntry && firstCacheEntry.qr) renderQrMatrix(firstCacheEntry.qr);
      else renderQr(firstFrame);
      var initialRenderMs = performance.now() - planStart;
      txFrameStartTime = performance.now();
      $('txPlaceholder').classList.add('hidden');
      if ($('txInputDetails')) $('txInputDetails').open = false;
      $('playTx').disabled = false;
      $('pauseTx').disabled = true;
      updateTxPlayBadge();
      $('txPayloadSize').textContent = formatBytes(wireBytes.length);
      $('txQrGenMs').textContent = cacheResult.durationMs.toFixed(1) + ' ms';
      $('txCacheStatus').textContent = 'QR事前生成: ' + cacheResult.cachedFrames + ' / ' + cacheResult.totalFrames + ' 枚';
      $('txFrameInfo').textContent = frameLabel;
      $('txProgress').style.width = (txMode === 'fountain' || hybridMode ? (1 / blockCount * 100) : 0).toFixed(1) + '%';
      updateTxBlockMap();
      status('txStatus',
        '準備完了: ' + sourceName + ' · ' + formatBytes(sourceBytes.length) +
        '。QRコードを受信側のカメラに向け、読み取り確認後に送信を開始してください。',
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
      txFountainQrCacheIndex = 1;
      txQrCacheBytes = 0;
      $('txCacheStatus').textContent = 'QR事前生成: 失敗';
      $('playTx').disabled = true;
      $('pauseTx').disabled = true;
      $('txPlaceholder').classList.remove('hidden');
      status('txStatus', '準備失敗: ' + error.message, 'error');
      return false;
    } finally {
      $('prepareTx').disabled = autoTestRunning;
    }
  }

  function stopTx() {
    txPlaying = false;
    txIsRendering = false;
    txPausedByVisibility = false;
    txRenderGeneration++;
    if (txRafId) {
      cancelAnimationFrame(txRafId);
      txRafId = 0;
    }
    if (txTimer) clearTimeout(txTimer);
    txTimer = 0;
    $('playTx').disabled = !(txPlan || txFountainEncoder);
    $('pauseTx').disabled = true;
    updateTxPlayBadge();
  }

  function txAnimationLoop(now) {
    txRafId = 0;
    if (!txPlaying) {
      return;
    }

    // バックグラウンド中はフレーム進行を停止（visibilitychange で復帰時に再開）
    if (typeof document !== 'undefined' && document.hidden) {
      txRafId = 0;
      return;
    }

    var effectiveFps = txAutoRateController.enabled ? txAutoRateController.currentFps : Number(valueOf('fps', '10'));
    var targetInterval = 1000 / Math.max(1, effectiveFps);

    // 初回描画時刻が未記録なら現在時刻で初期化
    if (!txFrameStartTime) {
      txFrameStartTime = now;
    }

    // 最低表示時間を保証：現在フレームの表示時間が targetInterval 未満なら次の rAF を待つ
    if (now - txFrameStartTime < targetInterval) {
      txRafId = requestAnimationFrame(txAnimationLoop);
      return;
    }

    // すでに非同期フレーム生成（Fountain等）または描画が進行中の場合は多重実行を防ぐ
    if (txIsRendering) {
      txRafId = requestAnimationFrame(txAnimationLoop);
      return;
    }

    // 目標表示時間を満たしたため、次のフレームへ進む
    showNextFrame();
  }

  async function showNextFrame() {
    if (!txPlan && !txFountainEncoder) return;
    if (txIsRendering) return;
    txIsRendering = true;
    var renderGeneration = ++txRenderGeneration;
    var started = performance.now();
    // Cadence is measured from frame-switch start; QR generation time is no longer added after the wait.
    txFrameStartTime = started;
    try {
      var frame;
      var cachedQr = null;
      var hybridMode = txMode === 'hybrid' || txMode === 'hybrid-data';
      if (hybridMode && txHybridPhase === 'legacy' && txIndex >= txPlan.frames.length) {
        txHybridPhase = 'fountain';
        status('txStatus', '送信を続けています…', 'info');
      }
      var fountainPhase = txMode === 'fountain' || (hybridMode && txHybridPhase === 'fountain');
      if (fountainPhase) {
        var cachedFountainEntry = txMode === 'fountain' && txFountainQrCacheIndex < txFountainQrCache.length
          ? txFountainQrCache[txFountainQrCacheIndex++] : null;
        var nextFountainPart = cachedFountainEntry
          ? cachedFountainEntry.part
          : await txFountainEncoder.nextPart();
        if (renderGeneration !== txRenderGeneration || !txPlaying) return;
        cachedQr = cachedFountainEntry ? cachedFountainEntry.qr : null;
        txFountainPart = nextFountainPart;
        frame = txFountainPart.frame;
        txCurrentBlocks = new Set(txFountainPart.indexes);
        txCurrentLabel = 'LT seq ' + txFountainPart.seqNum + ' · ' +
          (txFountainPart.direct ? 'Data再送' : 'XOR修復') + ' · ' +
          (txFountainPart.indexes.length <= 4
            ? '対象 ' + txFountainPart.indexes.map(function (index) { return index + 1; }).join(',')
            : txFountainPart.indexes.length + 'ブロック合成');
        $('txFrameCount').textContent = '送信中';
        $('txFrameInfo').textContent = '';
        $('txProgress').style.width =
          (Math.min(txFountainEncoder.seqLen, txFountainPart.seqNum) / txFountainEncoder.seqLen * 100).toFixed(1) + '%';
      } else {
        var legacyFrameIndex = txIndex;
        frame = txPlan.frames[legacyFrameIndex];
        cachedQr = txQrMatrixCache[legacyFrameIndex] ? txQrMatrixCache[legacyFrameIndex].qr : null;
        var parsed = Core.parseFrame(frame);
        txCurrentBlocks = new Set(packetBlockIndexes(parsed));
        if (parsed.type === 'data') txCurrentLabel = 'Data ' + (parsed.index + 1) + ' / ' + parsed.total;
        else txCurrentLabel = 'P' + parsed.parityType + ' · group ' + (parsed.group + 1) +
          ' · block ' + (parsed.group * Core.GROUP_SIZE + 1) + '–' +
          Math.min(parsed.total, (parsed.group + 1) * Core.GROUP_SIZE);
        var effectiveFps = txAutoRateController.enabled ? txAutoRateController.currentFps : Number(valueOf('fps', '10'));
        $('txFrameInfo').textContent = '';
        $('txProgress').style.width = ((txIndex + 1) / txPlan.frames.length * 100).toFixed(1) + '%';
        if (hybridMode) txIndex++;
        else txIndex = (txIndex + 1) % txPlan.frames.length;
      }
      if (renderGeneration !== txRenderGeneration || !txPlaying) return;
      if (cachedQr) renderQrMatrix(cachedQr);
      else renderQr(frame);
      updateTxBlockMap();
      recordTxDisplayFrame(performance.now());

      // During an automatic sweep, send one finite pass per condition so RX records one run.
      if (autoTestRunning && txPlaying) {
        var autoStop = false;
        if (txMode === 'fountain') {
          autoStop = txFountainPart && txFountainPart.seqNum >= Math.ceil(txFountainEncoder.seqLen * 1.6);
        } else if (txMode === 'hybrid' || txMode === 'hybrid-data') {
          autoStop = txHybridPhase === 'fountain' && txFountainPart &&
            txFountainPart.seqNum >= Math.ceil(txFountainEncoder.seqLen * 1.6);
        } else {
          autoStop = txIndex >= txPlan.frames.length;
        }
        if (autoStop) { stopTx(); return; }
      }
      var elapsed = performance.now() - started;
      $('txQrGenMs').textContent = elapsed.toFixed(1) + ' ms';
      txAutoRateController.recordRender(elapsed);
    } catch (error) {
      if (renderGeneration !== txRenderGeneration) return;
      stopTx();
      if (autoTestRunning) autoTestErrorMessage = error.message || String(error);
      status('txStatus', 'QR生成エラー: ' + error.message + '。密度を下げてください。', 'error');
    } finally {
      txIsRendering = false;
      // 送信継続中なら次の rAF ループを要求して最低表示時間の待機へ入る
      if (txPlaying && !txRafId && !(typeof document !== 'undefined' && document.hidden)) {
        txRafId = requestAnimationFrame(txAnimationLoop);
      }
    }
  }

  function playTx() {
    if ((!txPlan && !txFountainEncoder) || txPlaying) return;
    txPlaying = true;
    txPausedByVisibility = false;
    $('playTx').disabled = true;
    $('pauseTx').disabled = false;
    updateTxPlayBadge();
    // 再生開始時、現在画面に表示されているフレームの表示開始時刻を現在時刻に設定
    txFrameStartTime = performance.now();
    txDisplayWindowStart = txFrameStartTime;
    txDisplayWindowFrames = 0;
    txLastFrameSwitchAt = txFrameStartTime;
    $('txDisplayFps').textContent = '計測中';
    if (!txRafId && !txIsRendering) {
      txRafId = requestAnimationFrame(txAnimationLoop);
    }
  }

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
        if (txPlaying && txPausedByVisibility) {
          txPausedByVisibility = false;
          // 復帰直後のフレームスキップを防ぐため、現在フレームの表示開始時刻を復帰時刻でリセット
          txFrameStartTime = performance.now();
          txDisplayWindowStart = txFrameStartTime;
          txDisplayWindowFrames = 0;
          txLastFrameSwitchAt = txFrameStartTime;
          if (!txRafId && !txIsRendering) {
            txRafId = requestAnimationFrame(txAnimationLoop);
          }
        }
        if (stream && !receivedDone) {
          scheduleScan(0);
        }
      }
    });
  }

  function updateTxPlayBadge() {
    var badge = $('txPlayBadge');
    if (!badge) return;
    if (!txPlan && !txFountainEncoder) {
      badge.classList.add('hidden');
      return;
    }
    if (txPlaying) {
      // 再生中はQRコード読み取りの邪魔になるためバッジを完全非表示にする
      badge.classList.add('hidden');
    } else {
      // 一時停止中のみタップ再生案内を表示
      badge.textContent = '⏸ 一時停止中（タップで再開）';
      badge.className = 'qr-stage-badge paused';
      badge.classList.remove('hidden');
    }
  }

  function toggleTxPlayback() {
    if (!txPlan && !txFountainEncoder) return;
    if (txPlaying) {
      stopTx();
      status('txStatus', '送信を一時停止しました。QRコードをタップすると再開できます。', 'info');
    } else {
      playTx();
      status('txStatus', '送信中です。QRコードをタップすると一時停止できます。', 'info');
    }
  }

  var txStage = $('txStage');
  if (txStage) {
    // A browser-generated click is shared by mouse and touch. Keep one handler only.
    // Adding touchend/pointerup here would cause a tap to toggle playback twice.
    txStage.addEventListener('click', function (event) {
      if (event && event.target && event.target.closest &&
          event.target.closest('a,button,input,select,textarea')) return;
      if (!txPlan && !txFountainEncoder) return;
      toggleTxPlayback();
    });
  }

  $('prepareTx').addEventListener('click', prepareTx);
  $('playTx').addEventListener('click', playTx);
  $('pauseTx').addEventListener('click', function () {
    stopTx();
    status('txStatus', '送信を一時停止しました。送信開始またはQRコードのタップで再開できます。', 'info');
  });

  async function runTxAutoTest() {
    if (autoTestRunning) {
      autoTestWasCancelled = true;
      autoTestRunning = false;
      if (autoTestTimer) clearTimeout(autoTestTimer);
      autoTestTimer = 0;
      if (autoTestResolve) { autoTestResolve(); autoTestResolve = null; }
      stopTx();
      autoTestPayloadBytes = null;
      $('autoTxTest').textContent = '選択条件で自動ベンチマーク';
      $('prepareTx').disabled = false;
      status('txStatus', '自動ベンチマークを停止しました。', 'info');
      return;
    }

    var requestedBytes = selectedBenchmarkBytes();
    var selectedMode = valueOf('transferMode', 'hybrid-data');
    var selectedChunk = Number(valueOf('chunkSize', '800'));
    var selectedFps = Number(valueOf('fps', '10'));
    autoTestPayloadBytes = createBenchmarkPayload(requestedBytes);
    autoTestRunning = true;
    autoTestWasCancelled = false;
    autoTestErrorMessage = '';
    if ($('autoTxLog')) $('autoTxLog').value = 'case,mode,data_bytes,chunk_bytes,fps,transfer_id,estimated_duration_ms\n';
    $('autoTxTest').textContent = '自動ベンチマークを停止';
    $('prepareTx').disabled = true;
    status('txStatus',
      'TXベンチマークを準備しています。RX側のカメラ状態は確認しません。RX側は別途カメラを開始し、先頭QRを読み取ってください（ACK／同期なし）。',
      'info');

    var failure = '';
    try {
      var prepared = await prepareTx();
      if (!autoTestRunning) return;
      if (!prepared || (!txPlan && !txFountainEncoder)) {
        failure = 'ベンチマーク用データの準備に失敗しました。TXのエラー表示を確認してください。';
        return;
      }
      var units = txMode === 'fountain'
        ? Math.ceil(txFountainEncoder.seqLen * 1.6)
        : (txMode === 'hybrid' || txMode === 'hybrid-data')
          ? txPlan.frames.length + Math.ceil(txFountainEncoder.seqLen * 1.6)
          : txPlan.frames.length;
      var duration = Math.min(2147483647,
        Math.max(10000, Math.ceil(units * 1000 / Math.max(1, selectedFps) * 1.35 + 3500)));
      var transferId = txMode === 'fountain' ? txFountainEncoder.id : txPlan.id;
      if ($('autoTxLog')) $('autoTxLog').value += [
        1, selectedMode, requestedBytes, selectedChunk, selectedFps, transferId, duration
      ].join(',') + '\n';
      status('txStatus',
        '自動ベンチマーク送信中 · ' + formatBytes(requestedBytes) +
        ' · ' + selectedMode + ' · chunk ' + selectedChunk + ' B · ' + selectedFps +
        ' fps · 推定 ' + formatElapsedMs(duration) +
        ' · RXの準備状態は送信側では判定できません。',
        'info');
      playTx();
      await new Promise(function (resolve) {
        autoTestResolve = resolve;
        autoTestTimer = setTimeout(function () {
          autoTestTimer = 0;
          autoTestResolve = null;
          resolve();
        }, duration);
      });
      if (!autoTestRunning) return;
      if (autoTestErrorMessage) failure = '送信中にエラーが発生しました: ' + autoTestErrorMessage;
    } catch (error) {
      failure = '自動ベンチマークを中断しました: ' + error.message;
    } finally {
      autoTestRunning = false;
      if (autoTestTimer) clearTimeout(autoTestTimer);
      autoTestTimer = 0;
      autoTestResolve = null;
      stopTx();
      autoTestPayloadBytes = null;
      $('autoTxTest').textContent = '選択条件で自動ベンチマーク';
      $('prepareTx').disabled = false;
      if (!autoTestWasCancelled) {
        if (failure) status('txStatus', failure, 'error');
        else status('txStatus', '自動ベンチマーク送信を終了しました。RX側の計測結果とTransfer IDを照合してください。', 'ok');
      }
    }
  }

  function resetRx() {
    if (autoResetTimer) { clearTimeout(autoResetTimer); autoResetTimer = 0; }
    if (rxRateAdvisor) rxRateAdvisor.reset();
    rx.reset();
    fountainRx.reset();
    fountainRx.gaussianEnabled = !!$('rxGaussianEnabled').checked;
    $('runRxGaussian').disabled = !fountainRx.gaussianEnabled;
    $('rxGaussianStatus').textContent = fountainRx.gaussianEnabled
      ? 'GF(2)実験: 使用可能。カメラ停止後に手動実行してください。受信中はpeelingのみです。'
      : '通常受信中はpeelingのみ。ガウス消去は無効です。';
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
    scanDecodeTotalMs = 0;
    scanIngestTotalMs = 0;
    scanDecodeSamples = [];
    benchmarkRunRecorded = false;
    rxMapDirty = false;
    scanStartAt = 0;
    scanFirstHitAt = 0;
    transferTiming.startedAt = null;
    transferTiming.endedAt = null;
    transferTiming.frameCount = 0;
    var guide = $('rxDistanceGuide');
    if (guide) {
      updateDistanceGuide(false, null, 0);
    }
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
    $('rxProgress').style.width = '0%';
    $('rxProgressText').textContent = '0 / 0';
    $('rxRate').textContent = '0.0';
    $('rxElapsed').textContent = '—';
    $('rxAvgMs').textContent = '0 ms';
    $('rxP50Ms').textContent = '—';
    $('rxP95Ms').textContent = '—';
    $('rxSamples').textContent = '0 / 0';
    $('rxIngestMs').textContent = '0 ms';
    $('rxThroughput').textContent = '—';
    $('rxFileRate').textContent = '—';
    rxWireByteCount = null;
    rxOutputByteCount = null;
    $('rxWireBytes').textContent = '—';
    $('rxOutputBytes').textContent = '—';
    benchmarkPeakHeapBytes = null;
    benchmarkHeapLimitBytes = null;
    $('rxMemoryPeak').textContent = '—';
    $('rxLost').textContent = '—';
    $('rxRecovered').textContent = '0';
    $('rxHitRate').textContent = '0%';
    $('rxBlockSummary').textContent = '受信を開始するとブロック状態が表示されます';
    drawBlockMap('rxBlockMap', 0, null, null, null);
    rxMapDirty = false;
    $('rxResultMeta').textContent = '';
    if ($('rxCompletionCard')) $('rxCompletionCard').classList.add('hidden');
    $('downloadResult').classList.add('hidden');
    $('downloadResult').removeAttribute('href');
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    status('rxStatus', '受信待機中です。カメラを起動してQRコードを読み取ってください。', 'info');
  }

  function updateRxStats() {
    var elapsedMs = elapsedTransferMs(transferTiming, performance.now());
    var elapsed = elapsedMs === null ? 0 : elapsedMs / 1000;
    $('rxElapsed').textContent = elapsedMs === null ? '—' : formatElapsedMs(elapsedMs);
    var have;
    var total;
    var recovered;
    var directSet;
    var recoveredSet;
    var activeSet;
    if (activeProtocol === 'fountain' || activeProtocol === 'hybrid') {
      have = fountainRx.simpleParts.size;
      total = fountainRx.seqLen;
      recovered = fountainRx.recoveredIndexes.size;
      directSet = fountainRx.directIndexes;
      recoveredSet = fountainRx.recoveredIndexes;
      activeSet = null;
      $('rxBlockSummary').textContent = '';
    } else {
      have = rx.shards.size;
      total = rx.total;
      recovered = rx.recoveredCount;
      directSet = rxDirectBlocks;
      recoveredSet = new Set();
      rx.shards.forEach(function (_value, index) {
        if (!rxDirectBlocks.has(index)) recoveredSet.add(index);
      });
      activeSet = null;
      $('rxBlockSummary').textContent = '';
    }
    $('rxProgressText').textContent = have + ' / ' + total;
    $('rxProgress').style.width = total ? (have / total * 100).toFixed(1) + '%' : '0%';
    $('rxRate').textContent = elapsed >= 1 ? (transferTiming.frameCount / elapsed).toFixed(2) : '0.0';
    $('rxAvgMs').textContent = scanAttempts ? (scanDecodeTotalMs / scanAttempts).toFixed(1) + ' ms' : '0 ms';
    if (scanAttempts === 0 || scanAttempts % 8 === 0 || receivedDone) {
      var p50 = percentileValue(scanDecodeSamples, 0.50);
      var p95 = percentileValue(scanDecodeSamples, 0.95);
      $('rxP50Ms').textContent = p50 === null ? '—' : p50.toFixed(1) + ' ms';
      $('rxP95Ms').textContent = p95 === null ? '—' : p95.toFixed(1) + ' ms';
    }
    $('rxIngestMs').textContent = scanHits ? (scanIngestTotalMs / scanHits).toFixed(1) + ' ms' : '0 ms';
    $('rxSamples').textContent = scanAttempts + ' / ' + scanHits;
    $('rxMemoryPeak').textContent = benchmarkPeakHeapBytes === null
      ? '非対応' : formatBytes(benchmarkPeakHeapBytes);
    $('rxLost').textContent = total ? String(Math.max(0, total - have)) : '—';
    $('rxRecovered').textContent = String(recovered);
    $('rxHitRate').textContent = scanAttempts ? (scanHits / scanAttempts * 100).toFixed(1) + '%' : '0%';
    if (rxMapDirty) {
      drawBlockMap('rxBlockMap', total, directSet, recoveredSet, activeSet);
      rxMapDirty = false;
    }
  }

  function currentRxProgress() {
    if (activeProtocol === 'fountain' || activeProtocol === 'hybrid') {
      return { have: fountainRx.simpleParts.size, total: fountainRx.seqLen };
    }
    return { have: rx.shards.size, total: rx.total };
  }

  function recordBenchmarkRun() {
    if (!receivedDone || benchmarkRunRecorded) return;
    var progress = currentRxProgress();
    var elapsedMs = elapsedTransferMs(transferTiming, performance.now());
    var p50 = percentileValue(scanDecodeSamples, 0.50);
    var p95 = percentileValue(scanDecodeSamples, 0.95);
    var camera = rxCameraSettings || {};
    var sampleCount = scanAttempts;
    var run = {
      recordedAt: new Date().toISOString(),
      transferId: rxTransferId,
      txMode: activeProtocol || '',
      requestedResolution: camera.requestedResolution || rxRequestedResolution || '',
      actualWidth: camera.width || '',
      actualHeight: camera.height || '',
      actualFrameRate: camera.frameRate || '',
      observedVideoFps: cameraObservedFps,
      scanner: scannerName,
      attempts: sampleCount,
      hits: scanHits,
      hitRatePercent: sampleCount ? scanHits / sampleCount * 100 : 0,
      decodeMeanMs: sampleCount ? scanDecodeTotalMs / sampleCount : null,
      decodeP50Ms: p50,
      decodeP95Ms: p95,
      uniqueFrames: transferTiming.frameCount,
      uniqueFramesPerSecond: elapsedMs && elapsedMs > 0
        ? transferTiming.frameCount * 1000 / elapsedMs : null,
      receivedBlocks: progress.have,
      totalBlocks: progress.total,
      missingBlocks: Math.max(0, progress.total - progress.have),
      wireBytes: rxWireByteCount,
      outputBytes: rxOutputByteCount,
      memoryPeakBytes: benchmarkPeakHeapBytes,
      memoryLimitBytes: benchmarkHeapLimitBytes,
      completionMs: elapsedMs,
      samples: scanDecodeSamples.slice()
    };
    benchmarkRuns.push(run);
    benchmarkRunRecorded = true;
    $('benchmarkRunCount').textContent =
      '完了した計測: ' + benchmarkRuns.length + '件（このページを開いている間保持）';
    var copyBenchmarkButton = $('copyBenchmarkText');
    if (copyBenchmarkButton) copyBenchmarkButton.disabled = false;
  }

  function benchmarkResultsText() {
    var lines = [
      'Data Transfer Test Lab — 計測結果',
      '計測日時\tTransfer ID\tモード\t要求解像度\t実解像度\t実測映像FPS\t読み取り方式\t検出率(%)\t解析平均(ms)\t解析P95(ms)\t有効フレーム/秒\t受信ブロック\t総ブロック\t欠損ブロック\t転送データ量(B)\t復元ファイル量(B)\tJSヒープ最大(B)\tJSヒープ上限(B)\t完了時間(ms)'
    ];
    benchmarkRuns.forEach(function (run) {
      lines.push([
        run.recordedAt,
        run.transferId || '',
        run.txMode || '',
        run.requestedResolution || '',
        run.actualWidth && run.actualHeight ? run.actualWidth + 'x' + run.actualHeight : '',
        run.observedVideoFps === null ? '' : run.observedVideoFps,
        run.scanner || '',
        run.hitRatePercent.toFixed(2),
        run.decodeMeanMs === null ? '' : run.decodeMeanMs.toFixed(3),
        run.decodeP95Ms === null ? '' : run.decodeP95Ms.toFixed(3),
        run.uniqueFramesPerSecond === null ? '' : run.uniqueFramesPerSecond.toFixed(3),
        run.receivedBlocks,
        run.totalBlocks,
        run.missingBlocks,
        run.wireBytes === null ? '' : run.wireBytes,
        run.outputBytes === null ? '' : run.outputBytes,
        run.memoryPeakBytes === null ? '' : run.memoryPeakBytes,
        run.memoryLimitBytes === null ? '' : run.memoryLimitBytes,
        run.completionMs === null ? '' : run.completionMs.toFixed(1)
      ].join('\t'));
      if (run.samples && run.samples.length) {
        lines.push('Raw scan samples (ms) for ' + (run.transferId || 'unknown') + ':');
        run.samples.forEach(function (sample, index) {
          lines.push((index + 1) + '\t' + Number(sample).toFixed(3));
        });
      }
    });
    return lines.join('\n');
  }

  async function copyTextToClipboard(value, successMessage) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        var area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        var ok = document.execCommand('copy');
        area.remove();
        if (!ok) throw new Error('copy command unavailable');
      }
      status('rxStatus', successMessage, 'ok');
    } catch (_error) {
      var previousFallback = $('clipboardFallback');
      if (previousFallback) previousFallback.remove();
      var fallback = document.createElement('textarea');
      fallback.id = 'clipboardFallback';
      fallback.value = value;
      fallback.setAttribute('readonly', '');
      fallback.setAttribute('aria-label', 'コピー用テキスト');
      fallback.style.position = 'fixed';
      fallback.style.inset = '10px';
      fallback.style.width = 'calc(100% - 20px)';
      fallback.style.height = '40vh';
      fallback.style.opacity = '1';
      fallback.style.zIndex = '99999';
      fallback.style.background = '#fff';
      fallback.style.color = '#111';
      fallback.style.padding = '10px';
      document.body.appendChild(fallback);
      fallback.focus();
      fallback.select();
      status('rxStatus', '自動コピーできませんでした。画面に表示したテキストを選択してコピーしてください。', 'info');
    }
  }

  function copyBenchmarkText() {
    if (!benchmarkRuns.length) {
      status('rxStatus', 'コピーできる計測結果はまだありません。受信を完了すると計測結果が保存され、このボタンが有効になります。', 'info');
      $('benchmarkRunCount').textContent = '完了した計測: 0件（受信完了後にコピーできます）';
      return;
    }
    copyTextToClipboard(benchmarkResultsText(), '計測結果をテキストとしてコピーしました。メモ帳などに貼り付けて確認できます。');
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
    if (!nameLength || nameLength > 4096 || dataLength > MAX_BENCHMARK_BYTES ||
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
    var name = String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
    return name;
  }

  function stopCameraFpsMeasurement() {
    var video = $('camera');
    if (cameraFpsCallback !== null && video && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(cameraFpsCallback);
    }
    cameraFpsCallback = null;
    cameraFpsWindowStart = 0;
    cameraFpsWindowFrames = 0;
    cameraFpsPreviousPresentedFrames = null;
    cameraObservedFps = null;
    var output = $('rxObservedFps');
    if (output) output.textContent = '—';
  }

  function startCameraFpsMeasurement() {
    stopCameraFpsMeasurement();
    var video = $('camera');
    var output = $('rxObservedFps');
    if (!video || typeof video.requestVideoFrameCallback !== 'function') {
      if (output) output.textContent = '計測非対応';
      return;
    }
    cameraFpsWindowStart = performance.now();
    cameraFpsWindowFrames = 0;
    cameraFpsPreviousPresentedFrames = null;

    function onVideoFrame(now, metadata) {
      if (!stream || !video.srcObject) {
        cameraFpsCallback = null;
        return;
      }
      var presented = metadata && Number.isFinite(metadata.presentedFrames)
        ? metadata.presentedFrames : null;
      if (presented !== null && cameraFpsPreviousPresentedFrames !== null) {
        cameraFpsWindowFrames += Math.max(0, presented - cameraFpsPreviousPresentedFrames);
      } else {
        cameraFpsWindowFrames += 1;
      }
      cameraFpsPreviousPresentedFrames = presented;
      var elapsed = now - cameraFpsWindowStart;
      if (elapsed >= 1000) {
        cameraObservedFps = cameraFpsWindowFrames * 1000 / elapsed;
        if (output) output.textContent = cameraObservedFps.toFixed(1) + ' fps';
        cameraFpsWindowStart = now;
        cameraFpsWindowFrames = 0;
      }
      cameraFpsCallback = video.requestVideoFrameCallback(onVideoFrame);
    }
    cameraFpsCallback = video.requestVideoFrameCallback(onVideoFrame);
  }

  function captureCameraSettings() {
    var cameraTrack = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
    var settings = {};
    var settingsAvailable = !!(cameraTrack && typeof cameraTrack.getSettings === 'function');
    if (settingsAvailable) {
      try { settings = cameraTrack.getSettings() || {}; }
      catch (_) { settings = {}; settingsAvailable = false; }
    }
    var video = $('camera');
    var width = Number(settings.width) || (video && video.videoWidth) || 0;
    var height = Number(settings.height) || (video && video.videoHeight) || 0;
    var frameRate = Number(settings.frameRate) || 0;
    rxCameraSettings = {
      requestedResolution: rxRequestedResolution || valueOf('rxResolution', '640x480'),
      width: width,
      height: height,
      frameRate: frameRate,
      fromGetSettings: settingsAvailable
    };
    $('rxCameraSettings').textContent =
      '要求: ' + rxCameraSettings.requestedResolution +
      ' · 実解像度: ' + (width && height ? width + '×' + height : '取得不可') +
      ' · 実FPS: ' + (frameRate ? frameRate.toFixed(1) : '取得不可') +
      (settingsAvailable ? ' · getSettings()' : ' · video intrinsic size fallback');
    return rxCameraSettings;
  }

  async function finishReceive(bytes) {
    if (receivedDone) return;
    receivedDone = true;
    var unpacked = await Core.decompressIfWrapped(bytes);
    var named = unpackNamedPayload(unpacked.bytes);
    var finalBytes = named.bytes;
    var name = safeFilename(named.filename) || 'received-file.bin';
    var blob = new Blob([finalBytes], { type: 'application/octet-stream' });
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    var link = $('downloadResult');
    link.href = objectUrl;
    link.download = name;
    link.classList.remove('hidden');
    var completedElapsedMs = elapsedTransferMs(transferTiming, performance.now());
    rxWireByteCount = bytes.length;
    rxOutputByteCount = finalBytes.length;
    $('rxWireBytes').textContent = formatBytes(rxWireByteCount) + ' (' + rxWireByteCount.toLocaleString() + ' B)';
    $('rxOutputBytes').textContent = formatBytes(rxOutputByteCount) + ' (' + rxOutputByteCount.toLocaleString() + ' B)';
    $('rxThroughput').textContent = completedElapsedMs === null ? '—' : formatRate(bytes.length, completedElapsedMs);
    $('rxFileRate').textContent = completedElapsedMs === null ? '—' : formatRate(finalBytes.length, completedElapsedMs);
    var firstDetection = scanFirstHitAt && scanStartAt ? ((scanFirstHitAt - scanStartAt) / 1000).toFixed(2) + '秒' : '—';
    var cameraSettings = captureCameraSettings();
    var cameraSize = cameraSettings.width && cameraSettings.height ? cameraSettings.width + '×' + cameraSettings.height : '—';
    $('rxResultMeta').textContent = 'CRC32検証済み · 転送ID ' +
      ((activeProtocol === 'fountain' || activeProtocol === 'hybrid') ? fountainRx.id : rx.id);
    if ($('rxCompletionSize')) $('rxCompletionSize').textContent =
      formatBytes(finalBytes.length) + ' (' + finalBytes.length.toLocaleString() + ' bytes)';
    if ($('rxCompletionTime')) $('rxCompletionTime').textContent =
      completedElapsedMs === null ? '—' : formatElapsedMs(completedElapsedMs);
    if ($('rxCompletionSpeed')) $('rxCompletionSpeed').textContent =
      completedElapsedMs === null ? '—' : formatRate(finalBytes.length, completedElapsedMs);
    if ($('rxCompletionCard')) $('rxCompletionCard').classList.remove('hidden');
    status('rxStatus', '転送が完了しました。ファイルを保存できます。', 'ok');
    updateRxStats();
    if ($('autoBenchmarkReset') && $('autoBenchmarkReset').checked) {
      // In benchmark mode, keep the camera alive; scanTick records this run before reset.
      if (autoResetTimer) clearTimeout(autoResetTimer);
      autoResetTimer = setTimeout(function () {
        autoResetTimer = 0;
        if ($('autoBenchmarkReset').checked && receivedDone) resetRx();
      }, 1800);
    } else {
      stopCamera();
    }
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
        throw new Error('先頭QRではありません。TXを停止し、Data 1（またはLT seq 1）を表示してから読み取ってください');
      }
      var isFountain = Wire.isFountainFrame(rawText);
      var hybridTransition = isFountain && activeProtocol === 'legacy';
      if (!isFountain && (activeProtocol === 'fountain' || activeProtocol === 'hybrid')) {
        throw new Error('同じ転送中にLegacyフレームへ戻ることはできません');
      }
      var result, have, total, recovered;
      if (isFountain) {
        var fountainPacket = Fountain.parseFrame(rawText);
        if (!rxTransferId) rxTransferId = fountainPacket.id;
        if (hybridTransition) {
          if (rx.id !== fountainPacket.id || rx.total !== fountainPacket.seqLen) {
            throw new Error('HybridのLT修復フレームが初回CMAL1と同じ転送ID／ブロック数ではありません');
          }
          hybridFountainMeta = fountainPacket;
          hybridImportedBlocks.clear();
          rx.shards.forEach(function (block, index) {
            fountainRx.addKnownBlock(hybridFountainMeta, index, block, rxDirectBlocks.has(index));
            hybridImportedBlocks.add(index);
          });
          activeProtocol = 'hybrid';
          status('rxStatus', '初回データで不足したブロックをLT修復中です。', 'info');
        } else if (activeProtocol === null) activeProtocol = 'fountain';
        else if (activeProtocol !== 'fountain' && activeProtocol !== 'hybrid') {
          throw new Error('別の転送方式のフレームです。受信をリセットしてください');
        }
        result = await fountainRx.feed(rawText);
        var indexes = result.lastIndexes || await fountainRx.chooser.choose(fountainPacket.seqNum);
        rxCurrentBlocks = new Set(indexes);
        rxCurrentLabel = 'LT seq ' + fountainPacket.seqNum + ' · ' +
          (indexes.length <= 4
            ? 'blocks ' + indexes.map(function (index) { return index + 1; }).join(',')
            : indexes.length + ' blocks');
        have = fountainRx.simpleParts.size;
        total = fountainRx.seqLen;
        recovered = fountainRx.recoveredIndexes.size;
      } else {
        var packet = Core.parseFrame(rawText);
        if (!rxTransferId) rxTransferId = packet.id;
        result = rx.feed(rawText);
        rxCurrentBlocks = new Set(packetBlockIndexes(packet));
        if (packet.type === 'data') {
          rxDirectBlocks.add(packet.index);
          rxCurrentLabel = 'Data ' + (packet.index + 1) + ' / ' + packet.total;
        } else {
          rxCurrentLabel = 'P' + packet.parityType + ' · group ' + (packet.group + 1) +
            ' · block ' + (packet.group * Core.GROUP_SIZE + 1) + '–' +
            Math.min(packet.total, (packet.group + 1) * Core.GROUP_SIZE);
        }
        if (activeProtocol === null) activeProtocol = 'legacy';
        have = rx.shards.size;
        total = rx.total;
        recovered = rx.recoveredCount;
      }
      var transferTimerStarted = recordTransferFrame(transferTiming, firstFramePending, result.duplicate, performance.now());
      if (!result.duplicate) rxMapDirty = true;
      if (firstFramePending) rxFirstFrameCaptured = true;
      if (!result.duplicate) uniqueFrameCount++;
      if (rxRateAdvisor) {
        rxRateAdvisor.recordIngestResult(result.duplicate, result.complete);
      }
      if (result.complete && transferTiming.startedAt !== null && transferTiming.endedAt === null) {
        transferTiming.endedAt = performance.now();
      }
      updateRxStats();
      if (transferTimerStarted) {
        var guide = $('rxDistanceGuide');
        if (guide) guide.style.display = 'none';
        var targetBox = $('rxCameraTargetBox');
        if (targetBox) targetBox.style.display = 'none';
        status('rxStatus', '転送を開始しました。', 'ok');
      } else if (uniqueFrameCount <= 1) {
        status('rxStatus', 'QRコードを確認しました。送信側で送信開始を押してください。', 'ok');
      } else {
        var modeLabel = activeProtocol === 'hybrid' ? 'LT Hybrid（P0/P1取得分 + LT修復）'
          : isFountain ? 'Pure LTファウンテン' : 'CMAL1';
        status('rxStatus', modeLabel + ' 受信中 · ' + have + ' / ' + total + 'ブロック · 復元 ' + recovered + '片', 'info');
      }
      if (result.complete) {
        try { await finishReceive(result.bytes); }
        catch (error) {
          receivedDone = false;
          status('rxStatus', '復元後の展開・保存準備に失敗しました: ' + error.message, 'error');
        }
      }
    } catch (error) {
      status('rxStatus', 'フレーム拒否: ' + error.message, 'error');
    }
  }

  async function initScanner() {
    detector = null;
    zxingDecoder = null;
    scannerType = '';
    scannerPreference = $('rxScanner') ? valueOf('rxScanner', 'zxing-wasm') : 'zxing-wasm';
    var allowFallback = $('rxAllowFallback') ? $('rxAllowFallback').checked : false;
    var wasmError = null;
    var nativeError = null;

    // 1. ZXing-C++ WASM (3.1.6) を最優先で試行（実測でNativeより高速かつ安定）
    if (scannerPreference === 'auto' || scannerPreference === 'zxing-wasm') {
      $('scannerMode').textContent = '読み取り方式: ZXing-C++ WASMを準備中…';
      $('scannerMode').className = 'status info';
      try {
        if (!window.DataTransferZXingLoader ||
            typeof window.DataTransferZXingLoader.load !== 'function') {
          throw new Error('ZXing WASMローダーを読み込めません');
        }
        zxingDecoder = await window.DataTransferZXingLoader.load();
        if (!zxingDecoder || typeof zxingDecoder.readBarcodes !== 'function') {
          throw new Error('ZXing WASMのreadBarcodes APIが見つかりません');
        }
        scannerType = 'zxing-wasm';
        scannerName = 'ZXing-C++ WASM 3.1.6（最高速）';
        $('scannerMode').textContent = '読み取り方式: ' + scannerName;
        $('scannerMode').className = 'status info';
        return;
      } catch (error) {
        zxingDecoder = null;
        wasmError = error;
        // フォールバック未許可時は遅いNativeに勝手に落とさずエラー提示
        if (!allowFallback && scannerPreference === 'zxing-wasm') {
          throw new Error('ZXing-C++ WASMを起動できません: ' + error.message + '（互換フォールバックをONにしてください）');
        }
      }
    }

    // 2. 互換フォールバックが許可されている場合、または明示的に指定された場合のみ Native / jsQR を試行
    if (scannerPreference === 'native' || (allowFallback && (scannerPreference === 'auto' || scannerPreference === 'zxing-wasm'))) {
      if (typeof window.BarcodeDetector === 'function') {
        try {
          var formats = await window.BarcodeDetector.getSupportedFormats();
          if (formats.indexOf('qr_code') !== -1) {
            detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            scannerType = 'native';
            scannerName = 'Native BarcodeDetector' + (scannerPreference === 'auto' ? '（互換フォールバック）' : '');
          }
        } catch (error) {
          nativeError = error;
          detector = null;
        }
      }
      if (detector) {
        $('scannerMode').textContent = '読み取り方式: ' + scannerName;
        $('scannerMode').className = 'status info';
        return;
      }
      if (scannerPreference === 'native') {
        throw new Error(nativeError
          ? 'Native BarcodeDetector初期化失敗: ' + nativeError.message
          : 'このブラウザではQR対応のNative BarcodeDetectorを利用できません');
      }
    }

    // 3. 最終フォールバック: jsQR
    if (scannerPreference === 'jsqr' || (allowFallback && (scannerPreference === 'auto' || scannerPreference === 'zxing-wasm'))) {
      if (typeof window.jsQR !== 'function') {
        throw new Error('jsQR.jsを読み込めませんでした');
      }
      scannerType = 'jsqr';
      scannerName = scannerPreference === 'jsqr' ? 'jsQR（指定）' : 'jsQR（最終フォールバック）';
      var failReason = wasmError ? ' · WASM利用不可: ' + wasmError.message : (nativeError ? ' · Native利用不可: ' + nativeError.message : '');
      $('scannerMode').textContent = '読み取り方式: ' + scannerName + failReason;
      $('scannerMode').className = 'status info';
      return;
    }

    throw new Error('読み取り方式を初期化できませんでした。ZXing WASMが動かない環境の場合は「互換フォールバックを許可」にチェックを入れてください');
  }

  function updateDistanceGuide() {}

  function handleWorkerDecodeResult(msg) {
    rxWorkerBusy = false;
    // カメラ停止中、受信完了後、またはセッション世代が不一致（停止後の遅延結果）なら完全に破棄
    if (!stream || receivedDone || (msg.sessionId !== undefined && msg.sessionId !== rxScanSessionId)) {
      return;
    }
    var raw = msg.raw;
    var decodeElapsed = msg.elapsedMs || 0;

    var isHit = !!raw;
    var isNovel = false;
    if (transferTiming && transferTiming.startedAt === null) {
      updateDistanceGuide(isHit, msg.qrRatio, decodeElapsed);
    }
    if (raw) {
      scanHits++;
      scanConsecutiveNoQrCount = 0;
      if (!scanFirstHitAt) scanFirstHitAt = performance.now();
      var clean = raw.replace(/^[\r\n]+|[\r\n]+$/g, '');

      if (clean !== scanLastIngestedRawText) {
        isNovel = true;
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
    sampleBenchmarkMemory();
    scanDecodeSamples.push(decodeElapsed);
    if (scanDecodeSamples.length > 256) scanDecodeSamples.shift();
    scanDecodeTotalMs += decodeElapsed;
    updateRxStats();

    if (rxRateAdvisor) {
      rxRateAdvisor.recordScanAttempt(isHit, isNovel, decodeElapsed);
      rxRateAdvisor.recordQueueLength(scanIngestQueue.length);
      rxRateAdvisor.evaluate(performance.now());
    }

    // デコード完了後、もし解析中に新しい映像フレームが届いていれば直ちに最新フレームを処理
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
              if (scannerType === 'zxing-wasm' || scannerType === 'jsqr') {
                $('scannerMode').textContent = '読み取り方式: ' + scannerName + ' (Web Worker非同期)';
              }
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
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      status('rxStatus', 'カメラにはHTTPSまたはlocalhostが必要です。手動フレーム入力を利用してください。', 'error');
      return;
    }
    $('startCamera').disabled = true;
    if ($('rxScanner')) $('rxScanner').disabled = true;
    rxScanSessionId++;
    status('rxStatus', '読み取り方式を初期化しています…', 'info');
    try {
      await initScanner();
      await initQrWorker();
      var resolutionParts = String(valueOf('rxResolution', '640x480') || '1920x1080').split('x');
      var requestedWidth = Number(resolutionParts[0]);
      var requestedHeight = Number(resolutionParts[1]);
      if (!Number.isInteger(requestedWidth) || !Number.isInteger(requestedHeight) ||
          ![[640, 480], [1280, 720], [1920, 1080]].some(function (pair) {
            return pair[0] === requestedWidth && pair[1] === requestedHeight;
          })) {
        throw new Error('カメラ解像度の選択値が不正です');
      }
      rxRequestedResolution = requestedWidth + '×' + requestedHeight;
      rxCameraSettings = null;
      $('rxCameraSettings').textContent = '要求: ' + rxRequestedResolution + ' · 実解像度を取得中…';
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: requestedWidth },
          height: { ideal: requestedHeight },
          frameRate: { ideal: 30, max: 60 }
        },
        audio: false
      });
      var video = $('camera');
      video.srcObject = stream;
      await video.play();
      captureCameraSettings();
      startCameraFpsMeasurement();
      $('rxResolution').disabled = true;
      if ($('rxScanner')) $('rxScanner').disabled = true;
      $('startCamera').disabled = true;
      $('stopCamera').disabled = false;
      scanStartAt = performance.now();
      updateDistanceGuide(false, null, 0);
      status('rxStatus', '送信側に表示されたQRコードをカメラに映してください。', 'info');
      scheduleScan(0);
    } catch (error) {
      stopCamera();
      status('rxStatus', 'カメラを起動できませんでした: ' + error.message, 'error');
    }
  }

  function scheduleScan(delay) {
    if (!stream || receivedDone) return;
    var video = $('camera');
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

  function onScanVideoFrame(now, metadata) {
    scanVideoFrameCallback = null;
    if (!stream || receivedDone) return;
    var presented = metadata && Number.isFinite(metadata.presentedFrames)
      ? metadata.presentedFrames
      : null;
    scanLatestPresentedFrames = presented;

    // 解析ループがアイドルなら最新フレームの解析を開始
    triggerScanIfIdle();

    // 解析の進行状況にかかわらず、カメラ映像の監視ループを継続（最新フレームを逃さない）
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
    var video = $('camera');
    if (scanVideoFrameCallback !== null && video && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(scanVideoFrameCallback);
    }
    scanVideoFrameCallback = null;
  }

  function stopCamera() {
    cancelScanSchedule();
    stopCameraFpsMeasurement();
    rxScanSessionId++;
    if (stream) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
    }
    updateDistanceGuide(false, null, 0);
    var video = $('camera');
    if (video.srcObject) video.srcObject = null;
    scanBusy = false;
    scanLatestPresentedFrames = null;
    scanLastAnalyzedPresentedFrames = null;
    scanLastIngestedRawText = '';
    scanConsecutiveNoQrCount = 0;
    scanIngestQueue = [];
    scanIngestBusy = false;
    rxWorkerBusy = false;
    $('startCamera').disabled = false;
    $('stopCamera').disabled = true;
    $('rxResolution').disabled = false;
    if ($('rxScanner')) $('rxScanner').disabled = false;
  }

  function triggerScanIfIdle() {
    if (!stream || scanBusy || rxWorkerBusy || receivedDone) return;
    var video = $('camera');
    if (!video || video.readyState < 2 || !video.videoWidth) return;

    // rVFC でフレーム通番が取得できる場合、前回解析したフレームと同一なら重複解析をスキップ
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
        var ingestStarted = performance.now();
        try {
          await ingest(rawText);
        } finally {
          var ingestElapsed = performance.now() - ingestStarted;
          scanIngestTotalMs += ingestElapsed;
        }
      }
    } catch (error) {
      status('rxStatus', 'プロトコル受信エラー: ' + error.message, 'error');
    } finally {
      scanIngestBusy = false;
      if (receivedDone) recordBenchmarkRun();
      if (scanIngestQueue.length && !receivedDone) {
        drainIngestQueue();
      }
    }
  }

  async function detectQr(video) {
    // 1. Native BarcodeDetector (高速・GPU直結)
    if (detector) {
      try {
        var results = await detector.detect(video);
        var hit = results.find(function (item) { return Wire.isAirgapFrame(item.rawValue); });
        if (hit) return hit.rawValue;
      } catch (nativeError) {
        detector = null;
        scannerType = 'jsqr';
        if (scannerPreference === 'auto' && window.DataTransferZXingLoader) {
          try {
            zxingDecoder = await window.DataTransferZXingLoader.load();
            scannerType = 'zxing-wasm';
            scannerName = 'ZXing-C++ WASM 3.1.6（Native error fallback）';
          } catch (_) {
            scannerType = 'jsqr';
            scannerName = 'jsQR fallback (Native error)';
          }
        } else {
          scannerType = 'jsqr';
          scannerName = 'jsQR fallback (Native error)';
        }
        $('scannerMode').textContent = '読み取り方式: ' + scannerName;
      }
    }

    // 2. Canvas経由でのデコード (ZXing WASM / jsQR)
    var canvas = $('scanCanvas');
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
    var context = scanCachedContext;
    context.drawImage(video, 0, 0, width, height);

    // ROIスキャン（中央70%優先）
    // QRが中央にある場合は高速・省メモリで完了
    var roiRatio = 0.7;
    var roiW = Math.round(width * roiRatio);
    var roiH = Math.round(height * roiRatio);
    var roiX = Math.round((width - roiW) / 2);
    var roiY = Math.round((height - roiH) / 2);
    var roiImage = context.getImageData(roiX, roiY, roiW, roiH);

    var roiRaw = null;
    if (scannerType === 'zxing-wasm') {
      var roiZxingResults = await zxingDecoder.readBarcodes(roiImage, {
        formats: ['QRCode'],
        maxNumberOfSymbols: 1,
        tryHarder: false
      });
      var roiHit = roiZxingResults.find(function (item) {
        return item && Wire.isAirgapFrame(item.text);
      });
      if (roiHit) roiRaw = roiHit.text;
    } else {
      var roiDecoded = window.jsQR(roiImage.data, roiImage.width, roiImage.height, { inversionAttempts: 'dontInvert' });
      if (roiDecoded && Wire.isAirgapFrame(roiDecoded.data)) roiRaw = roiDecoded.data;
    }

    if (roiRaw) return roiRaw;

    // ROIで見つからなければ全画面スキャンへフォールバック
    var image = context.getImageData(0, 0, width, height);
    if (scannerType === 'zxing-wasm') {
      var zxingResults = await zxingDecoder.readBarcodes(image, {
        formats: ['QRCode'],
        maxNumberOfSymbols: 1,
        tryHarder: false
      });
      var zxingHit = zxingResults.find(function (item) {
        return item && Wire.isAirgapFrame(item.text);
      });
      if (zxingHit) return zxingHit.text;
    } else {
      var decoded = window.jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
      if (decoded && Wire.isAirgapFrame(decoded.data)) return decoded.data;
    }

    return null;
  }

  async function scanTick() {
    if (!stream || scanBusy || rxWorkerBusy || receivedDone) return;
    var video = $('camera');
    if (video.readyState < 2 || !video.videoWidth) {
      scheduleScan(30);
      return;
    }

    // 1. Web Worker による非同期デコード（Native Detector を使わない場合）
    if (rxWorkerReady && !rxWorkerFailed && !detector) {
      rxWorkerBusy = true;
      scanLastAnalyzedPresentedFrames = scanLatestPresentedFrames;

      var canvas = $('scanCanvas');
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
      } catch (err) {
        rxWorkerBusy = false;
        rxWorkerFailed = true;
      }
      return;
    }

    // 2. メインスレッドでの解析（Native BarcodeDetector、または Worker フォールバック）
    scanBusy = true;
    scanLastAnalyzedPresentedFrames = scanLatestPresentedFrames;

    var raw = null;
    var decodeElapsed = 0;
    try {
      var decodeStarted = performance.now();
      try {
        raw = await detectQr(video);
      } finally {
        decodeElapsed = performance.now() - decodeStarted;
      }

      var isHit = !!raw;
      var isNovel = false;
      if (raw) {
        scanHits++;
        scanConsecutiveNoQrCount = 0;
        if (!scanFirstHitAt) scanFirstHitAt = performance.now();
        var clean = raw.replace(/^[\r\n]+|[\r\n]+$/g, '');

        // 重複フレーム抑制: 直前と同一のQRコードが連続している間はプロトコル処理への重複投入をスキップ
        if (clean !== scanLastIngestedRawText) {
          isNovel = true;
          scanLastIngestedRawText = clean;
          enqueueIngest(clean);
        }
      } else {
        // QRが検出されなかった場合、5フレーム以上未検出が続けば直前QR記憶をクリア
        scanConsecutiveNoQrCount++;
        if (scanConsecutiveNoQrCount >= 5) {
          scanLastIngestedRawText = '';
        }
      }
    } catch (error) {
      status('rxStatus', '解析エラー: ' + error.message, 'error');
    } finally {
      scanAttempts++;
      sampleBenchmarkMemory();
      scanDecodeSamples.push(decodeElapsed);
      if (scanDecodeSamples.length > 256) scanDecodeSamples.shift();
      scanDecodeTotalMs += decodeElapsed;
      updateRxStats();
      if (transferTiming && transferTiming.startedAt === null) {
        updateDistanceGuide(isHit, null, decodeElapsed);
      }

      if (rxRateAdvisor) {
        rxRateAdvisor.recordScanAttempt(isHit, isNovel, decodeElapsed);
        rxRateAdvisor.recordQueueLength(scanIngestQueue.length);
        rxRateAdvisor.evaluate(performance.now());
      }
      scanBusy = false;

      // 解析完了時点で、もし解析中に新しい映像フレームが届いていれば直ちに最新フレームの解析を開始
      if (stream && !receivedDone) {
        if (scanLatestPresentedFrames !== null &&
            scanLatestPresentedFrames !== scanLastAnalyzedPresentedFrames) {
          triggerScanIfIdle();
        }
      }
    }
  }

  $('startCamera').addEventListener('click', startCamera);
  $('stopCamera').addEventListener('click', stopCamera);
  $('resetRx').addEventListener('click', resetRx);
  $('rxGaussianEnabled').addEventListener('change', function () {
    fountainRx.gaussianEnabled = $('rxGaussianEnabled').checked;
    $('runRxGaussian').disabled = !fountainRx.gaussianEnabled;
    $('rxGaussianStatus').textContent = fountainRx.gaussianEnabled
      ? 'GF(2)実験: 使用可能。カメラ停止後に手動実行してください。受信中はpeelingのみです。'
      : '通常受信中はpeelingのみ。ガウス消去は無効です。';
  });
  $('runRxGaussian').addEventListener('click', function () {
    if (!fountainRx.gaussianEnabled) return;
    var video = $('camera');
    var stream = video && video.srcObject;
    var cameraLive = !!(stream && stream.getTracks().some(function (track) { return track.readyState === 'live'; }));
    if (cameraLive || scanBusy || rxWorkerBusy || scanIngestBusy) {
      $('rxGaussianStatus').textContent = '実行中止: QR取りこぼし防止のため、カメラを停止して受信処理が終わってから実行してください。';
      return;
    }
    try {
      var gs = fountainRx.runGaussianElimination();
      $('rxGaussianStatus').textContent = gs.skipped
        ? 'GF(2): 安全上限でスキップ · 式 ' + gs.equationCount + ' · 非ゼロ係数 ' + gs.nonZeros
        : 'GF(2): rank ' + gs.rank + '/' + gs.variables + ' · 新規復元 ' +
          gs.recoveredBlocks + '片 · ' + gs.durationMs.toFixed(2) + ' ms';
      updateRxStats();
      if (fountainRx.isComplete()) {
        status('rxStatus', 'GF(2)ガウス消去で復元完了。データ全体のCRC32も検証済みです。', 'ok');
      }
    } catch (error) {
      $('rxGaussianStatus').textContent = 'GF(2)実験エラー: ' + (error && error.message ? error.message : String(error));
    }
  });
  $('ingestManual').addEventListener('click', function () {
    ingest(valueOf('manualFrame', '').replace(/^[\r\n]+|[\r\n]+$/g, ''));
  });

  if ($('runSelfTest')) {
    $('runSelfTest').addEventListener('click', async function () {
      var button = $('runSelfTest');
      button.disabled = true;
      try {
        var legacyResult = Core.selfTest();
        var fountainResult = await Fountain.selfTest();
        status('selfTestStatus',
          'PASS · 旧CMAL1/P0/P1 ' + legacyResult.pairPositions + '欠落位置 · ' +
          'LT公式chooserベクトル seq12=' + fountainResult.sequence12 +
          ' / seq13=' + fountainResult.sequence13 +
          ' · 順不同復元 · 2片欠落 · 重複処理 · CRC検証 · 転送混在拒否',
          'ok');
      } catch (error) {
        status('selfTestStatus', 'FAIL · ' + error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });
  }

  window.addEventListener('pagehide', function () {
    stopTx();
    stopCamera();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });

  if (!Core || typeof Core.buildFrames !== 'function' ||
      !Fountain || typeof Fountain.Encoder !== 'function' ||
      !Fountain.Encoder.prototype || typeof Fountain.Encoder.prototype.seekToBlock !== 'function' ||
      typeof Fountain.Encoder.prototype.startRepairPhase !== 'function' ||
      !Fountain.Receiver.prototype || typeof Fountain.Receiver.prototype.addKnownBlock !== 'function') {
    status('txStatus', '送信機能を初期化できませんでした。ページを再読み込みしてください。', 'error');
    $('prepareTx').disabled = true;
  }
  txAutoRateController.reset();
  rxRateAdvisor.reset();
  setValue('rxResolution', '640x480');
  setValue('transferMode', 'hybrid-data');
  updateModeControls();
  resetRx();
  updateTxBlockMap();

  if (typeof window !== 'undefined') {
    window.__dataTransferTestHooks = {
      detectQr: detectQr,
      triggerScanIfIdle: triggerScanIfIdle,
      enqueueIngest: enqueueIngest,
      getScanState: function () {
        return {
          scanBusy: scanBusy,
          scanLatestPresentedFrames: scanLatestPresentedFrames,
          scanLastAnalyzedPresentedFrames: scanLastAnalyzedPresentedFrames,
          scanLastIngestedRawText: scanLastIngestedRawText,
          scanIngestQueueLength: scanIngestQueue.length,
          scanIngestBusy: scanIngestBusy,
          rxWorkerReady: rxWorkerReady,
          rxWorkerBusy: rxWorkerBusy,
          rxWorkerFailed: rxWorkerFailed,
          rxScanSessionId: rxScanSessionId
        };
      },
      initQrWorker: initQrWorker,
      setScanLatestPresentedFrames: function (val) { scanLatestPresentedFrames = val; },
      onScanVideoFrame: onScanVideoFrame,
      rateController: rxRateAdvisor
    };
    window.dataTransfer = window.__dataTransferTestHooks;
    window.dataTransferRateController = rxRateAdvisor;
  }
})();
