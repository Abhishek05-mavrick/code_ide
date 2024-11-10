from flask import Flask, render_template

app = Flask(__name__)

@app.route("/")
def hello_world():
  return  render_template('index.html')

@app.route("/codepage")
def code_pages():
    return "<p>Hello code here :))</p>"


if __name__=="main":
    app.run(debug=True ,port=3001)



