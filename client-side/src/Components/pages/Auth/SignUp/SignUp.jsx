import Lottie from "lottie-react";
import signAnimation from "../../../../assets/lottie/sign.json";
import {
  Card,
  Input,
  Button,
  Typography,
  Select,
  Option,
} from "@material-tailwind/react";
import { Link, useNavigate } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import Swal from "sweetalert2";
import SyncHelmet from "../../Shared/Helmet/SyncHelmet";
import { useContext } from "react";
import { AuthContext } from "../../../providers/AuthProvider";
import useAxiosPublic from "../../../hooks/useAxiosPublic";
import SocialLogin from "../../Shared/SocialLogin/SocialLogin";

const SignUp = () => {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm();

  const { createUser, updateUserProfile } = useContext(AuthContext);
  const navigate = useNavigate();
  const axiosPublic = useAxiosPublic();

  const onSubmit = async (data) => {
    try {
      const { name, email, password, photoURL, role } = data;
      const userCredential = await createUser(email, password);
      if (userCredential) {
        await updateUserProfile(name, photoURL);
        const userInfo = {
          name: name,
          email: email,
          photoURL: photoURL,
          role: role,
        };
        await axiosPublic.post("/users", userInfo).then((res) => {
          if (res.data.insertedId) {
            console.log("User added successfully to database");
            Swal.fire({
              position: "top-end",
              icon: "success",
              title: "Your account had successfully created",
              showConfirmButton: false,
              timer: 2000,
            }).then(() => {
              navigate("/");
            });
          }
        });
      }
    } catch (error) {
      console.error("Error:", error);
      Swal.fire({
        position: "top-end",
        icon: "error",
        title: "There was an error creating your account",
        showConfirmButton: true,
      });
    }
  };

  return (
    <div>
      <SyncHelmet loc={"Sign Up"} />
      <div className="min-h-screen mt-10 p-2">
        <div className="flex items-center justify-around flex-col lg:flex-row p-10">
          <div className="hidden lg:block">
            <Lottie animationData={signAnimation} />
          </div>
          <div>
            <Card color="transparent" shadow={false}>
              <Typography
                variant="h4"
                className="text-center text-[#3DBDEC] sm:text-3xl lg:text-4xl"
              >
                Sign Up
              </Typography>

              <form
                className="mt-8 mb-2 w-80 max-w-screen-lg sm:w-96 px-5"
                onSubmit={handleSubmit(onSubmit)}
              >
                <div className="mb-1 flex flex-col gap-6">
                  <Typography variant="h6" color="blue-gray" className="-mb-3">
                    Your Name
                  </Typography>
                  <Input
                    size="lg"
                    name="name"
                    placeholder="John Doe"
                    className="border-t-blue-gray-200 focus:border-t-gray-900"
                    labelProps={{
                      className: "before:content-none after:content-none",
                    }}
                    {...register("name", { required: "Name is required" })}
                  />
                  {errors.name && (
                    <p className="text-red-500">{errors.name.message}</p>
                  )}

                  <Typography variant="h6" color="blue-gray" className="-mb-3">
                    Your Email
                  </Typography>
                  <Input
                    size="lg"
                    name="email"
                    placeholder="name@mail.com"
                    className="border-t-blue-gray-200 focus:border-t-gray-900"
                    labelProps={{
                      className: "before:content-none after:content-none",
                    }}
                    {...register("email", {
                      required: "Email is required",
                      pattern: {
                        value: /^\S+@\S+$/i,
                        message: "Invalid email address",
                      },
                    })}
                  />
                  {errors.email && (
                    <p className="text-red-500">{errors.email.message}</p>
                  )}

                  <Typography variant="h6" color="blue-gray" className="-mb-3">
                    Select Role
                  </Typography>
                  <Controller
                    name="role"
                    control={control}
                    defaultValue="user"
                    render={({ field }) => (
                      <Select {...field} label="Select Role">
                        <Option value="user">User</Option>
                        <Option value="seller">Seller</Option>
                      </Select>
                    )}
                  />
                  {errors.role && (
                    <p className="text-red-500">{errors.role.message}</p>
                  )}

                  <Typography variant="h6" color="blue-gray" className="-mb-3">
                    Password
                  </Typography>
                  <Input
                    type="password"
                    name="password"
                    size="lg"
                    placeholder="********"
                    className="border-t-blue-gray-200 focus:border-t-gray-900"
                    labelProps={{
                      className: "before:content-none after:content-none",
                    }}
                    {...register("password", {
                      required: "Password is required",
                      minLength: {
                        value: 6,
                        message: "Password must be at least 6 characters",
                      },
                      pattern: {
                        value: /^(?=.*[A-Z])(?=.*\d).+$/,
                        message:
                          "Password must contain at least one uppercase letter and one number",
                      },
                    })}
                  />
                  {errors.password && (
                    <p className="text-red-500">{errors.password.message}</p>
                  )}

                  <Typography variant="h6" color="blue-gray" className="-mb-3">
                    Photo URL
                  </Typography>
                  <Input
                    id="link"
                    size="lg"
                    name="photoURL"
                    placeholder="www.image.jpg"
                    className="border-t-blue-gray-200 focus:border-t-gray-900"
                    labelProps={{
                      className: "before:content-none after:content-none",
                    }}
                    {...register("photoURL")}
                  />
                </div>

                <Button type="submit" className="mt-6 bg-[#3DBDEC]" fullWidth>
                  Sign Up
                </Button>

                <Typography className="mt-4 text-center">
                  Or Sign Up with
                </Typography>

                <SocialLogin />

                <Typography
                  color="gray"
                  className="mt-4 text-center font-normal"
                >
                  Already have an account? {"  "}
                  <Link to="/login" className="font-medium text-[#3DBDEC]">
                    Log In
                  </Link>
                </Typography>
              </form>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignUp;
